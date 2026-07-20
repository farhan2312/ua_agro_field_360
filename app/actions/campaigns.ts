"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { shortStoreName } from "@/lib/store-utils";
import { SEGMENT_COLUMNS, segMeta } from "@/lib/campaign-segments";
import { inr } from "@/lib/format";
import type { Prisma } from "@prisma/client";
import {
  parseCriteria, resolveClusterCount, resolveClusterIds, scopedCriteriaWhere,
  hasConditions, type ClusterCriteria,
} from "@/lib/cluster-rules";
import { getScope, canManage, getActor } from "@/lib/scope";
import { cropLabel } from "@/lib/crops";

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
async function requireManager(): Promise<{ ok: true } | { ok: false; error: string }> {
  const { role } = await getScope();
  return canManage(role) ? { ok: true } : { ok: false, error: "Only the central team can create or change this." };
}

export type CropFilter = string; // "all" or a canonical crop name (see lib/crops.ts)
export type CropSource = "any" | "sales" | "visit"; // which labelled crop set to match

function cropColumn(source: CropSource): string {
  return source === "sales" ? `"salesCropTags"` : source === "visit" ? `"visitCropTags"` : `"cropTags"`;
}
function cropClause(crop: CropFilter, source: CropSource): string {
  if (!crop || crop === "all") return "";
  const safe = crop.replace(/[^a-z_]/gi, ""); // canonical crops are [a-z_]
  return safe ? `AND '${safe}' = ANY(${cropColumn(source)})` : "";
}

/** Distinct crops present across farmers (union of sales + visit), most common first. */
export async function getCropOptions(): Promise<{ crop: string; count: number }[]> {
  const rows = await prisma.$queryRawUnsafe<{ crop: string; n: number }[]>(
    `SELECT unnest("cropTags") crop, COUNT(*)::int n FROM "Farmer" WHERE source='REAL' AND array_length("cropTags",1) > 0 GROUP BY 1 ORDER BY 2 DESC`,
  );
  return rows.map((r) => ({ crop: r.crop, count: Number(r.n) }));
}

export interface MatrixRow {
  storeId: number | null;
  storeName: string;
  counts: Record<string, number>;
  total: number;
}
export interface SegmentMatrix {
  rows: MatrixRow[];
  totals: Record<string, number>;
  grandTotal: number;
}

/** Store × campaign-segment count matrix (optionally scoped to a crop + its source). */
export async function getSegmentMatrix(crop: CropFilter = "all", source: CropSource = "any"): Promise<SegmentMatrix> {
  const grouped = await prisma.$queryRawUnsafe<{ storeId: number | null; seg: string; n: number }[]>(
    `SELECT "storeId", "campaignSegment" AS seg, COUNT(*)::int AS n
     FROM "Farmer"
     WHERE "campaignSegment" IS NOT NULL AND "campaignSegment" <> 'OTHER' ${cropClause(crop, source)}
     GROUP BY "storeId", "campaignSegment"`,
  );
  const stores = await prisma.store.findMany({ select: { id: true, name: true } });
  const nameById = new Map(stores.map((s) => [s.id, shortStoreName(s.name)]));

  const byStore = new Map<number | null, Record<string, number>>();
  const totals: Record<string, number> = {};
  for (const g of grouped) {
    const m = byStore.get(g.storeId) ?? {};
    m[g.seg] = Number(g.n);
    byStore.set(g.storeId, m);
    totals[g.seg] = (totals[g.seg] ?? 0) + Number(g.n);
  }

  const rows: MatrixRow[] = [...byStore.entries()].map(([storeId, counts]) => ({
    storeId,
    storeName: storeId == null ? "Unassigned" : nameById.get(storeId) ?? `Store #${storeId}`,
    counts,
    total: SEGMENT_COLUMNS.reduce((s, k) => s + (counts[k] ?? 0), 0),
  }));
  rows.sort((a, b) => b.total - a.total);

  const grandTotal = SEGMENT_COLUMNS.reduce((s, k) => s + (totals[k] ?? 0), 0);
  return { rows, totals, grandTotal };
}

export interface SegmentCustomer {
  id: number;
  name: string;
  mobile: string | null;
  village: string | null;
  spend: string;
  gap: string | null;
  lastItem: string | null;
  medium: string;
  salesCrops: string[]; // labelled: from the sales upload
  visitCrops: string[]; // labelled: from field visits
}

/** Drill-down: farmers in a store × segment cell (optionally crop + source scoped). */
export async function getSegmentCustomers(
  storeId: number | null,
  segment: string,
  crop: CropFilter = "all",
  source: CropSource = "any",
  limit = 500,
): Promise<SegmentCustomer[]> {
  const cropField = source === "sales" ? "salesCropTags" : source === "visit" ? "visitCropTags" : "cropTags";
  const cropWhere: Prisma.FarmerWhereInput = crop && crop !== "all" ? { [cropField]: { has: crop } } : {};
  const farmers = await prisma.farmer.findMany({
    where: {
      campaignSegment: segment,
      ...(storeId == null ? { storeId: null } : { storeId }),
      ...cropWhere,
    },
    orderBy: { p12mSpend: "desc" },
    take: limit,
    select: {
      id: true, name: true, mobile: true, village: true, p12mSpend: true, hniGap: true,
      lastMaizeItem: true, lastPotatoItem: true, salesCropTags: true, visitCropTags: true,
    },
  });
  const med = segMeta(segment).medium;
  return farmers.map((f) => ({
    id: f.id,
    name: f.name,
    mobile: f.mobile,
    village: f.village,
    spend: f.p12mSpend != null ? inr(f.p12mSpend) : "—",
    gap: f.hniGap != null && f.hniGap > 0 ? inr(f.hniGap) : null,
    lastItem: f.lastMaizeItem ?? f.lastPotatoItem ?? null,
    medium: med,
    salesCrops: f.salesCropTags,
    visitCrops: f.visitCropTags,
  }));
}

/* ─────────────────────────── Clusters (Step 1) ─────────────────────────── */

export interface ClusterVM {
  id: number;
  name: string;
  description: string;
  count: number;
  origin: string;
  mode: string;
  createdBy: string;
}

/** All saved clusters with LIVE counts (dynamic clusters re-resolve their rule). */
export async function listClustersWithCounts(): Promise<ClusterVM[]> {
  const clusters = await prisma.cluster.findMany({
    where: { source: "REAL" }, // demo clusters must not be bundleable into real projects/campaigns
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, name: true, description: true, criteria: true, mode: true, origin: true, farmerIds: true, createdBy: true },
  });
  return mapLimit(clusters, 8, async (c) => {
    const crit = c.mode === "dynamic" ? parseCriteria(c.criteria) : null;
    const count = crit ? await resolveClusterCount(crit) : c.farmerIds.length;
    return {
      id: c.id,
      name: c.name,
      description: c.description ?? "—",
      count,
      origin: c.origin ?? "map",
      mode: c.mode,
      createdBy: c.createdBy ?? "",
    };
  });
}

/** Live count preview for the cluster rule builder (0 for an empty rule). */
export async function previewClusterCount(criteria: ClusterCriteria): Promise<number> {
  if (!hasConditions(criteria)) return 0;
  return resolveClusterCount(criteria);
}

export async function deleteCluster(id: number): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.cluster.delete({ where: { id } });
    revalidatePath("/campaigns");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed" };
  }
}

/* ─────────────────────────── Projects (Step 2) ─────────────────────────── */

type ClusterRow = { id: number; name: string; criteria: string | null; mode: string; farmerIds: number[] };

// Upper bound for a single campaign's enrolment. Comfortably above the whole
// ~106k REAL-farmer table, so realistic audiences enrol in full; hitting it means
// the audience is pathologically large and createCampaign refuses rather than
// silently dropping members (the count shown to the user is uncapped).
const ENROLL_CAP = 200_000;

/** A cluster's live Farmer `where` (dynamic → rule; static/legacy → frozen ids, REAL-scoped so a demo cluster can't leak demo farmers). */
function clusterWhere(c: ClusterRow): Prisma.FarmerWhereInput {
  const crit = c.mode === "dynamic" ? parseCriteria(c.criteria) : null;
  return crit ? scopedCriteriaWhere(crit) : { source: "REAL", id: { in: c.farmerIds } };
}
function clusterCountOf(c: ClusterRow): Promise<number> {
  const crit = c.mode === "dynamic" ? parseCriteria(c.criteria) : null;
  return crit ? resolveClusterCount(crit) : Promise.resolve(c.farmerIds.length);
}
function clusterIdsOf(c: ClusterRow, cap = ENROLL_CAP): Promise<number[]> {
  const crit = c.mode === "dynamic" ? parseCriteria(c.criteria) : null;
  // REAL-scope the static/legacy branch too (resolveClusterIds already scopes dynamic).
  return crit
    ? resolveClusterIds(crit, cap)
    : prisma.farmer.findMany({ where: { source: "REAL", id: { in: c.farmerIds } }, select: { id: true }, take: cap }).then((r) => r.map((x) => x.id));
}

/** Run an async fn over items with bounded concurrency (protects the pooled Azure DB). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  });
  await Promise.all(workers);
  return out;
}

export interface ProjectClusterVM { id: number; name: string; count: number }
export interface ProjectVM { id: number; name: string; status: string; audienceCount: number; startDate: string | null; endDate: string | null; clusters: ProjectClusterVM[] }

/** Projects with their clusters + de-duplicated live audience (union across clusters). */
export async function listProjects(): Promise<ProjectVM[]> {
  const projects = await prisma.project.findMany({
    where: { source: "REAL" }, // pipeline projects only; legacy/DEMO (Action Planner) projects are dateless and not campaign targets
    orderBy: { createdAt: "desc" }, take: 100,
    include: { clusters: { select: { id: true, name: true, criteria: true, mode: true, farmerIds: true } } },
  });
  // Resolve each DISTINCT cluster's live count ONCE (clusters are reusable across projects),
  // with bounded concurrency so one page load can't flood the connection-limited pool.
  const distinct = new Map<number, ClusterRow>();
  for (const p of projects) for (const c of p.clusters) distinct.set(c.id, c);
  const distinctRows = [...distinct.values()];
  const counts = await mapLimit(distinctRows, 8, (c) => clusterCountOf(c));
  const countById = new Map(distinctRows.map((c, i) => [c.id, counts[i]]));
  // Union audience per project (one OR-count that dedupes overlap), also concurrency-bounded.
  const audiences = await mapLimit(projects, 8, (p) =>
    p.clusters.length ? prisma.farmer.count({ where: { OR: p.clusters.map(clusterWhere) } }) : Promise.resolve(0),
  );
  return projects.map((p, i) => ({
    id: p.id, name: p.title, status: p.status, audienceCount: audiences[i],
    startDate: iso(p.startDate), endDate: iso(p.endDate),
    clusters: p.clusters.map((c) => ({ id: c.id, name: c.name, count: countById.get(c.id) ?? 0 })),
  }));
}

export async function createProject(name: string, clusterIds: number[], startDate?: string, endDate?: string): Promise<{ ok: boolean; id?: number; error?: string }> {
  const perm = await requireManager(); if (!perm.ok) return perm;
  const t = name.trim();
  if (!t) return { ok: false, error: "Give the project a name." };
  if (!clusterIds.length) return { ok: false, error: "Add at least one cluster." };
  if (!startDate || !endDate) return { ok: false, error: "Set a project start and end date." };
  const s = new Date(startDate), e = new Date(endDate);
  if (!(s <= e)) return { ok: false, error: "End date must be on or after the start date." };
  try {
    const p = await prisma.project.create({
      data: { title: t, status: "PLANNED", source: "REAL", startDate: s, endDate: e, clusters: { connect: clusterIds.map((id) => ({ id })) } },
    });
    revalidatePath("/projects"); revalidatePath("/campaigns");
    return { ok: true, id: p.id };
  } catch (e2) { return { ok: false, error: e2 instanceof Error ? e2.message : "Create failed" }; }
}

/** Extend a project's end date (central only). Campaigns can then be extended up to the new end. */
export async function extendProject(projectId: number, newEndDate: string): Promise<{ ok: boolean; error?: string }> {
  const perm = await requireManager(); if (!perm.ok) return perm;
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { endDate: true } });
  if (!p) return { ok: false, error: "Project not found." };
  const nd = new Date(newEndDate);
  if (p.endDate && !(nd > p.endDate)) return { ok: false, error: `New end must be after the current end (${iso(p.endDate)}).` };
  try {
    await prisma.project.update({ where: { id: projectId }, data: { endDate: nd } });
    revalidatePath("/projects"); revalidatePath("/campaigns");
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Extend failed" }; }
}

export async function setProjectClusters(projectId: number, clusterIds: number[]): Promise<{ ok: boolean; error?: string }> {
  const perm = await requireManager(); if (!perm.ok) return perm;
  try {
    await prisma.project.update({ where: { id: projectId }, data: { clusters: { set: clusterIds.map((id) => ({ id })) } } });
    revalidatePath("/projects"); revalidatePath("/campaigns");
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Update failed" }; }
}

export async function deleteProject(id: number): Promise<{ ok: boolean; error?: string }> {
  const perm = await requireManager(); if (!perm.ok) return perm;
  try { await prisma.project.delete({ where: { id } }); revalidatePath("/projects"); revalidatePath("/campaigns"); return { ok: true }; }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Delete failed" }; }
}

/* ─────────────────────────── WF3 · Communication plan ─────────────────────────── */

export interface CommTemplatePatch {
  name?: string; language?: string; promoType?: string; segment?: string;
  medium?: string; offer?: string; timingLabel?: string; template?: string;
}

export async function saveCommTemplate(id: number, patch: CommTemplatePatch): Promise<{ ok: boolean; error?: string }> {
  const perm = await requireManager(); if (!perm.ok) return perm; // central-only config (read-only for officers/RMs)
  if (patch.name !== undefined && !patch.name.trim()) return { ok: false, error: "Give the comm plan a name." };
  try {
    await prisma.commTemplate.update({ where: { id }, data: patch });
    revalidatePath("/campaigns");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed" };
  }
}

export async function createCommTemplate(data: Required<CommTemplatePatch>): Promise<{ ok: boolean; id?: number; error?: string }> {
  const perm = await requireManager(); if (!perm.ok) return perm;
  if (!data.name.trim()) return { ok: false, error: "Give the comm plan a name." };
  const dup = await prisma.commTemplate.findFirst({ where: { name: data.name.trim() }, select: { id: true } });
  if (dup) return { ok: false, error: "A comm plan with that name already exists." };
  try {
    const row = await prisma.commTemplate.create({ data: { ...data, name: data.name.trim(), priority: 5 } });
    revalidatePath("/campaigns");
    return { ok: true, id: row.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Create failed" };
  }
}

export async function deleteCommTemplate(id: number): Promise<{ ok: boolean; error?: string }> {
  const perm = await requireManager(); if (!perm.ok) return perm;
  try {
    await prisma.commTemplate.delete({ where: { id } });
    revalidatePath("/campaigns");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed" };
  }
}

/* ─────────────────────────── WF4 · Campaigns & tracking ─────────────────────────── */

export interface CreateCampaignInput {
  name: string;
  startDate: string; // ISO date
  endDate: string;
  projectId: number; // Step 3: campaign runs on a project…
  clusterId?: number | null; // …or one specific cluster within it (null = whole project)
  commPlans: string[]; // comm-plan names this campaign is tagged with (1+ required)
  testPct?: number;
}

const CLUSTER_SELECT = { id: true, name: true, criteria: true, mode: true, farmerIds: true } as const;

export async function createCampaign(input: CreateCampaignInput): Promise<{ ok: boolean; id?: number; members?: number; skipped?: number; error?: string }> {
  const perm = await requireManager(); if (!perm.ok) return perm;
  try {
    if (!input.name.trim()) return { ok: false, error: "Name is required." };
    if (!input.projectId) return { ok: false, error: "Pick a project." };
    if (!input.startDate || !input.endDate) return { ok: false, error: "Set the campaign start and end date." };
    // Every campaign must carry its communication plan(s) — tagged by comm-plan name.
    const commPlans = [...new Set((input.commPlans ?? []).map((s) => s.trim()).filter(Boolean))];
    if (!commPlans.length) return { ok: false, error: "Tag at least one comm plan." };

    // Load the project (its duration + segments).
    const project = await prisma.project.findUnique({ where: { id: input.projectId }, include: { clusters: { select: CLUSTER_SELECT } } });
    if (!project) return { ok: false, error: "Project not found." };
    // A campaign must sit inside a real project window — reject dateless (legacy/DEMO) projects outright.
    if (project.source !== "REAL" || !project.startDate || !project.endDate)
      return { ok: false, error: "This project has no start/end dates set. Set the project's dates first." };

    // Campaign window must sit inside the project's duration.
    const cs = new Date(input.startDate), ce = new Date(input.endDate);
    if (!(cs <= ce)) return { ok: false, error: "Campaign end must be on or after its start." };
    if (project.startDate && cs < project.startDate) return { ok: false, error: `Campaign can't start before the project (${iso(project.startDate)}).` };
    if (project.endDate && ce > project.endDate) return { ok: false, error: `Campaign can't end after the project (${iso(project.endDate)}). Extend the project first.` };

    // Resolve the audience id-set — a single segment, or the union of the project's segments.
    let ids: number[];
    if (input.clusterId) {
      const c = project.clusters.find((x) => x.id === input.clusterId);
      if (!c) return { ok: false, error: "That cluster is not part of the selected project." };
      ids = await clusterIdsOf(c);
    } else {
      if (!project.clusters.length) return { ok: false, error: "This project has no clusters." };
      const sets = await Promise.all(project.clusters.map((c) => clusterIdsOf(c)));
      ids = [...new Set(sets.flat())]; // de-duplicate farmers shared across segments
    }
    if (!ids.length) return { ok: false, error: "The selected audience is empty right now." };

    // Cross-campaign de-dup: never enrol a farmer already in ANOTHER campaign of this project
    // (one project = one contact per farmer, so later campaigns don't spam them).
    // NOTE: this is an app-level check-then-insert, not transactional. The create button is
    // pending-disabled so a single user can't double-submit; two managers creating campaigns on
    // the SAME project at the exact same moment is the only residual race (rare, manager-gated).
    const already = await prisma.campaignMember.findMany({ where: { campaign: { projectId: input.projectId } }, select: { farmerId: true }, distinct: ["farmerId"] });
    const alreadySet = new Set(already.map((a) => a.farmerId));
    const gross = ids.length;
    ids = ids.filter((id) => !alreadySet.has(id));
    const skipped = gross - ids.length;
    if (!ids.length) return { ok: false, error: "Every farmer here is already enrolled in another campaign of this project." };
    if (ids.length >= ENROLL_CAP) return { ok: false, error: `Audience is too large to enrol in one campaign (${ENROLL_CAP.toLocaleString("en-IN")}+). Narrow the project first.` };

    const camp = await prisma.campaign.create({
      data: { name: input.name.trim(), startDate: cs, endDate: ce, projectId: input.projectId, clusterId: input.clusterId ?? null, commPlans, testPct: input.testPct ?? 75, status: "ACTIVE" },
    });

    // Enrol snapshot; store/zone denormalized so officers/RMs see only their own farmers. 75/25 test/control.
    const controlEvery = Math.max(2, Math.round(100 / (100 - (input.testPct ?? 75)))); // ~4 for 75/25
    let total = 0;
    for (let i = 0; i < ids.length; i += 5000) {
      const slice = ids.slice(i, i + 5000);
      const farmers = await prisma.farmer.findMany({ where: { id: { in: slice } }, select: { id: true, campaignSegment: true, cropTags: true, storeId: true, zone: true } });
      const members = farmers.map((f) => ({
        campaignId: camp.id, farmerId: f.id, segment: f.campaignSegment ?? "OTHER",
        crop: f.cropTags[0] ?? null, storeId: f.storeId ?? null, zone: f.zone ?? null,
        group: f.id % controlEvery === 0 ? "CONTROL" : "TEST",
      }));
      const res = await prisma.campaignMember.createMany({ data: members, skipDuplicates: true });
      total += res.count;
    }
    revalidatePath("/campaigns");
    return { ok: true, id: camp.id, members: total, skipped };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Create failed" };
  }
}

/** Extend a campaign's end date (central only). Cannot exceed the project's end — extend the project first. */
export async function extendCampaign(campaignId: number, newEndDate: string): Promise<{ ok: boolean; error?: string }> {
  const perm = await requireManager(); if (!perm.ok) return perm;
  const camp = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { endDate: true, projectId: true } });
  if (!camp) return { ok: false, error: "Campaign not found." };
  const nd = new Date(newEndDate);
  if (!(nd > camp.endDate)) return { ok: false, error: `New end must be after the current end (${iso(camp.endDate)}).` };
  if (camp.projectId) {
    const p = await prisma.project.findUnique({ where: { id: camp.projectId }, select: { endDate: true } });
    if (p?.endDate && nd > p.endDate) return { ok: false, error: `Can't extend past the project end (${iso(p.endDate)}). Extend the project first.` };
  }
  try {
    await prisma.campaign.update({ where: { id: campaignId }, data: { endDate: nd } });
    revalidatePath("/campaigns");
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Extend failed" }; }
}

export interface CampaignListItem {
  id: number; name: string; status: string; startDate: string; endDate: string;
  target: string; members: number;
  commPlans: string[]; // comm-plan names the campaign is tagged with
}

/** Member `where` for the current user's scope (officer→their store, RM→their zone). null = see all. */
async function memberScopeWhere(): Promise<Prisma.CampaignMemberWhereInput | null | "none"> {
  const { role, storeId, zone } = await getScope();
  if (role === "officer") return storeId == null ? "none" : { storeId };
  if (role === "regional") return zone == null ? "none" : { zone };
  return null; // central / sysadmin
}

export async function listCampaigns(): Promise<CampaignListItem[]> {
  const scope = await memberScopeWhere();
  if (scope === "none") return []; // officer/RM with no store/zone → nothing to show
  const camps = await prisma.campaign.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    where: scope ? { members: { some: scope } } : undefined, // only campaigns that reach my store/zone
    include: { _count: { select: { members: scope ? { where: scope } : true } } }, // scoped member count
  });
  // Batch-resolve target names (loose ids — campaigns don't relation-load project/cluster).
  const projIds = [...new Set(camps.map((c) => c.projectId).filter((x): x is number => x != null))];
  const clusIds = [...new Set(camps.map((c) => c.clusterId).filter((x): x is number => x != null))];
  const [projs, clus] = await Promise.all([
    projIds.length ? prisma.project.findMany({ where: { id: { in: projIds } }, select: { id: true, title: true } }) : Promise.resolve([]),
    clusIds.length ? prisma.cluster.findMany({ where: { id: { in: clusIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const pName = new Map(projs.map((p) => [p.id, p.title]));
  const cName = new Map(clus.map((c) => [c.id, c.name]));
  return camps.map((c) => ({
    id: c.id, name: c.name, status: c.status,
    startDate: c.startDate.toISOString().slice(0, 10),
    endDate: c.endDate.toISOString().slice(0, 10),
    commPlans: c.commPlans,
    target: c.clusterId
      ? `Cluster · ${cName.get(c.clusterId) ?? "removed"}`
      : c.projectId
        ? `Project · ${pName.get(c.projectId) ?? "removed"}`
        : c.targetSegments.map((s) => segMeta(s).label).join(", ") || "—", // legacy segment campaigns
    members: c._count.members,
  }));
}

/** Scoped enrolled-farmer list for a campaign — TEST group only (the CONTROL holdout is never contacted). */
export interface CampaignMemberVM {
  id: number; name: string; mobile: string | null; village: string | null; store: string | null;
  segment: string; reached: boolean; mediums: string[]; comment: string | null; reachedAt: string | null;
  reachedBy: string | null; reachedByCode: string | null;
}
export async function getCampaignMembers(campaignId: number, limit = 1000): Promise<CampaignMemberVM[]> {
  const scope = await memberScopeWhere();
  if (scope === "none") return [];
  const members = await prisma.campaignMember.findMany({
    where: { campaignId, group: "TEST", ...(scope ?? {}) }, // officers/RMs contact only the TEST group
    take: limit, orderBy: { id: "asc" },
    select: { id: true, farmerId: true, segment: true, reached: true, mediums: true, comment: true, reachedAt: true, reachedBy: true, reachedByCode: true, storeId: true },
  });
  if (!members.length) return [];
  const [farmers, stores] = await Promise.all([
    prisma.farmer.findMany({ where: { id: { in: members.map((m) => m.farmerId) } }, select: { id: true, name: true, mobile: true, village: true } }),
    prisma.store.findMany({ select: { id: true, name: true } }),
  ]);
  const fMap = new Map(farmers.map((f) => [f.id, f]));
  const sMap = new Map(stores.map((s) => [s.id, shortStoreName(s.name)]));
  return members.map((m) => {
    const f = fMap.get(m.farmerId);
    return {
      id: m.id, name: f?.name ?? `Farmer #${m.farmerId}`, mobile: f?.mobile ?? null, village: f?.village ?? null,
      store: m.storeId != null ? sMap.get(m.storeId) ?? null : null,
      segment: m.segment, reached: m.reached, mediums: m.mediums, comment: m.comment, reachedAt: iso(m.reachedAt),
      reachedBy: m.reachedBy, reachedByCode: m.reachedByCode,
    };
  });
}

const CONTACT_MEDIA = new Set(["CALL", "WHATSAPP", "SMS", "IN_PERSON"]); // an approach ⇒ reached
const OUTCOMES = new Set([...CONTACT_MEDIA, "UNREACHABLE"]); // valid outcome values (UNREACHABLE = parked, not reached)

/**
 * Officer/RM (or central) records an outreach outcome. `mediums` is a SET — one farmer can be
 * reached by several approaches (e.g. Call + WhatsApp):
 *   any of CALL|WHATSAPP|SMS|IN_PERSON → reached; [UNREACHABLE] alone → parked (done, not reached);
 *   [] / null → back to pending.
 * `reached` is derived from the set (never trusted from the client). Scope-guarded to own store/zone.
 */
export async function markCampaignMember(
  memberId: number,
  patch: { mediums?: string[] | null; comment?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const { role, storeId, zone } = await getScope();
  const member = await prisma.campaignMember.findUnique({ where: { id: memberId }, select: { storeId: true, zone: true, group: true } });
  if (!member) return { ok: false, error: "Member not found." };
  // Officers/RMs may only touch their own store's / region's members; central/sysadmin may touch any.
  if (role === "officer") { if (storeId == null || member.storeId !== storeId) return { ok: false, error: "This farmer isn't in your store." }; }
  else if (role === "regional") { if (zone == null || member.zone !== zone) return { ok: false, error: "This farmer isn't in your region." }; }
  else if (!canManage(role)) return { ok: false, error: "Not authorised." };
  if (member.group !== "TEST") return { ok: false, error: "This farmer is a control holdout — not contacted." };

  const data: Prisma.CampaignMemberUpdateInput = {};
  if (patch.mediums !== undefined) {
    // Normalise to a validated, de-duplicated set — the client may send anything.
    const meds = [...new Set((patch.mediums ?? []).map((m) => String(m).trim().toUpperCase()).filter(Boolean))];
    if (meds.some((m) => !OUTCOMES.has(m))) return { ok: false, error: "Pick Call, WhatsApp, SMS, In-person or Unreachable." };
    // "Unreachable" is an outcome, not an approach — it can't be combined with one.
    if (meds.includes("UNREACHABLE") && meds.length > 1) return { ok: false, error: "Unreachable can't be combined with an approach." };
    const reached = meds.some((m) => CONTACT_MEDIA.has(m)); // UNREACHABLE / empty ⇒ not reached
    const recorded = meds.length > 0;
    data.mediums = meds;
    data.reached = reached;
    data.reachedAt = recorded ? new Date() : null; // when the outcome (reach OR unreachable) was recorded
    const actor = await getActor(); // audit: the ACTUAL logged-in user, never the impersonated persona
    data.reachedBy = recorded ? actor.name : null;
    data.reachedByCode = recorded ? actor.code : null;
  }
  if (patch.comment !== undefined) data.comment = patch.comment?.trim() ? patch.comment.trim().slice(0, 500) : null;
  try {
    await prisma.campaignMember.update({ where: { id: memberId }, data });
    revalidatePath("/campaigns");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed" };
  }
}

export interface UpliftRow {
  segment: string;
  test: { farmers: number; reached: number; purchased: number; avg: number };
  control: { farmers: number; purchased: number; avg: number };
  upliftPurchasePct: number; // test%purch − control%purch
  upliftAvg: number;
  incremental: number;
}

/* ── Attribution: which purchases count as "campaign revenue" ── */
interface ProductFilter { crops: string[]; categories: string[]; all: boolean }

/** Mirror a campaign's segment filters into the products that count as campaign-related. */
function productFilterOf(criteria: ClusterCriteria[]): ProductFilter {
  const crops = new Set<string>(), cats = new Set<string>();
  for (const c of criteria) {
    for (const x of c.cropTags ?? []) crops.add(x);
    for (const x of c.salesCrops ?? []) crops.add(x);
    for (const x of c.visitCrops ?? []) crops.add(x);
    if (c.crop) crops.add(c.crop);
    if (c.category) cats.add(c.category);
  }
  return { crops: [...crops], categories: [...cats], all: crops.size === 0 && cats.size === 0 };
}

/** SaleLine `where` for campaign-matched purchases by the given farmers within [start,end]. */
function matchedLineWhere(pf: ProductFilter, farmerIds: number[], start: Date, end: Date): Prisma.SaleLineWhereInput {
  const base: Prisma.SaleLineWhereInput = { farmerId: { in: farmerIds }, soldAt: { gte: start, lte: end } };
  if (pf.all) return base; // segment isn't product-specific → every purchase counts
  const or: Prisma.SaleLineWhereInput[] = [];
  // Prefer the per-line crop captured from the master file's Crops column (covers crops with no
  // crop-specific product, e.g. potato); also match seed products carrying a crop tag.
  if (pf.crops.length) { or.push({ cropTag: { in: pf.crops } }); or.push({ product: { cropTag: { in: pf.crops } } }); }
  if (pf.categories.length) or.push({ mainCategory: { in: pf.categories } });
  return { ...base, OR: or };
}

/** Sum matched line revenue per farmer, chunked to protect the pooled DB. */
async function matchedSpendByFarmer(pf: ProductFilter, farmerIds: number[], start: Date, end: Date): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  for (let i = 0; i < farmerIds.length; i += 15000) {
    const slice = farmerIds.slice(i, i + 15000);
    const rows = await prisma.saleLine.groupBy({ by: ["farmerId"], where: matchedLineWhere(pf, slice, start, end), _sum: { totalPrice: true } });
    for (const r of rows) if (r.farmerId != null) out.set(r.farmerId, Math.round(r._sum.totalPrice ?? 0));
  }
  return out;
}

export interface CampaignReach { testTotal: number; reached: number; byApproach: { CALL: number; WHATSAPP: number; SMS: number; IN_PERSON: number; unspecified: number } }
export interface CampaignAttribution {
  basisLabel: string; crops: string[]; categories: string[]; all: boolean; noCatalogMatch: boolean;
  windowStart: string; windowEnd: string;
  reachedFarmers: number; payingFarmers: number; matchedRevenue: number; totalRevenue: number;
}
export interface CampaignTracker { reach: CampaignReach; attribution: CampaignAttribution; uplift: UpliftRow[] }

/**
 * Campaign Tracker (managers only): outreach reach + real attributed revenue + test/control uplift.
 * Attributed revenue = matched purchases (segment-mirrored products) by CONTACTED (reached) TEST farmers,
 * over the window [campaign start, campaign end + 30 days]. Populated as monthly sales are imported.
 */
export async function getCampaignTracker(campaignId: number): Promise<CampaignTracker | null> {
  const { role } = await getScope();
  if (!canManage(role)) return null; // officers/RMs execute via the scoped farmer list, not the tracker
  const camp = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!camp) return null;

  // Resolve the campaign's segment criteria (one cluster, or every cluster in its project).
  let clusterIds: number[] = camp.clusterId ? [camp.clusterId] : [];
  if (!clusterIds.length && camp.projectId) {
    const proj = await prisma.project.findUnique({ where: { id: camp.projectId }, include: { clusters: { select: { id: true } } } });
    clusterIds = proj?.clusters.map((c) => c.id) ?? [];
  }
  const clusterRows = clusterIds.length ? await prisma.cluster.findMany({ where: { id: { in: clusterIds } }, select: { criteria: true } }) : [];
  const criteria = clusterRows.map((c) => parseCriteria(c.criteria)).filter((x): x is ClusterCriteria => !!x);
  const pf = productFilterOf(criteria);

  // Flag when the campaign's crop matches NO sales data at all (no per-line crop tag and no crop-tagged
  // product) — e.g. before the SaleLine crop backfill has run, or a crop simply absent from sales.
  let noCatalogMatch = false;
  if (!pf.all && pf.crops.length && pf.categories.length === 0) {
    const [line, prod] = await Promise.all([
      prisma.saleLine.findFirst({ where: { cropTag: { in: pf.crops } }, select: { id: true } }),
      prisma.product.findFirst({ where: { cropTag: { in: pf.crops } }, select: { id: true } }),
    ]);
    noCatalogMatch = !line && !prod;
  }

  const start = camp.startDate;
  const end = new Date(camp.endDate); end.setDate(end.getDate() + 30); // +30-day grace tail

  const members = await prisma.campaignMember.findMany({ where: { campaignId }, select: { farmerId: true, segment: true, group: true, reached: true, mediums: true } });
  const test = members.filter((m) => m.group === "TEST");
  const reachedMembers = test.filter((m) => m.reached);
  // Approaches are multi-select, so a farmer reached by Call AND WhatsApp counts under both:
  // these buckets can sum to more than `reached` (the UI says so).
  const byApproach = { CALL: 0, WHATSAPP: 0, SMS: 0, IN_PERSON: 0, unspecified: 0 };
  for (const m of reachedMembers) {
    const keys = m.mediums.map((x) => x.toUpperCase()).filter((k): k is "CALL" | "WHATSAPP" | "SMS" | "IN_PERSON" =>
      k === "CALL" || k === "WHATSAPP" || k === "SMS" || k === "IN_PERSON");
    if (keys.length === 0) byApproach.unspecified++;
    else for (const k of keys) byApproach[k]++;
  }

  // Matched spend per farmer for ALL members (uplift needs the control baseline); total spend for reached test (context).
  const allIds = [...new Set(members.map((m) => m.farmerId))];
  const matched = await matchedSpendByFarmer(pf, allIds, start, end);
  const reachedIds = reachedMembers.map((m) => m.farmerId);
  const totalSpend = await matchedSpendByFarmer({ crops: [], categories: [], all: true }, reachedIds, start, end);

  const matchedRevenue = reachedMembers.reduce((s, m) => s + (matched.get(m.farmerId) ?? 0), 0);
  const totalRevenue = [...totalSpend.values()].reduce((a, b) => a + b, 0);
  const payingFarmers = reachedMembers.filter((m) => (matched.get(m.farmerId) ?? 0) > 0).length;

  // Uplift per segment — test vs control, on MATCHED spend in window (the real values).
  type Acc = { tF: number; tR: number; tP: number; tSum: number; cF: number; cP: number; cSum: number };
  const bySeg = new Map<string, Acc>();
  for (const m of members) {
    const a = bySeg.get(m.segment) ?? { tF: 0, tR: 0, tP: 0, tSum: 0, cF: 0, cP: 0, cSum: 0 };
    const spend = matched.get(m.farmerId) ?? 0;
    const bought = spend > 0;
    if (m.group === "TEST") { a.tF++; if (m.reached) a.tR++; if (bought) { a.tP++; a.tSum += spend; } }
    else { a.cF++; if (bought) { a.cP++; a.cSum += spend; } }
    bySeg.set(m.segment, a);
  }
  const uplift: UpliftRow[] = [...bySeg.entries()].map(([segment, a]) => {
    const testPurchPct = a.tR > 0 ? a.tP / a.tR : a.tF > 0 ? a.tP / a.tF : 0;
    const ctrlPurchPct = a.cF > 0 ? a.cP / a.cF : 0;
    const testAvg = a.tP > 0 ? a.tSum / a.tP : 0;
    const ctrlAvg = a.cP > 0 ? a.cSum / a.cP : 0;
    const upliftPct = testPurchPct - ctrlPurchPct;
    const reachedOrFarmers = a.tR > 0 ? a.tR : a.tF;
    return {
      segment,
      test: { farmers: a.tF, reached: a.tR, purchased: a.tP, avg: Math.round(testAvg) },
      control: { farmers: a.cF, purchased: a.cP, avg: Math.round(ctrlAvg) },
      upliftPurchasePct: Math.round(upliftPct * 1000) / 10,
      upliftAvg: Math.round(testAvg - ctrlAvg),
      incremental: Math.round(reachedOrFarmers * upliftPct * testAvg),
    };
  });

  const basisLabel = pf.all
    ? "All purchases (cluster isn't product-specific)"
    : [pf.crops.length ? `Crop: ${pf.crops.map(cropLabel).join(", ")}` : "", pf.categories.length ? `Category: ${pf.categories.join(", ")}` : ""].filter(Boolean).join(" · ");

  return {
    reach: { testTotal: test.length, reached: reachedMembers.length, byApproach },
    attribution: {
      basisLabel, crops: pf.crops, categories: pf.categories, all: pf.all, noCatalogMatch,
      windowStart: iso(start)!, windowEnd: iso(end)!,
      reachedFarmers: reachedMembers.length, payingFarmers, matchedRevenue, totalRevenue,
    },
    uplift,
  };
}
