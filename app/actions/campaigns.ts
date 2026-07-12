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

export type CropFilter = "all" | "maize" | "potato" | "both";

function cropClause(crop: CropFilter): string {
  if (crop === "maize") return `AND 'maize' = ANY("cropTags")`;
  if (crop === "potato") return `AND 'potato' = ANY("cropTags")`;
  if (crop === "both") return `AND 'maize' = ANY("cropTags") AND 'potato' = ANY("cropTags")`;
  return "";
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

/** Store × campaign-segment count matrix (optionally scoped to a crop). */
export async function getSegmentMatrix(crop: CropFilter): Promise<SegmentMatrix> {
  const grouped = await prisma.$queryRawUnsafe<{ storeId: number | null; seg: string; n: number }[]>(
    `SELECT "storeId", "campaignSegment" AS seg, COUNT(*)::int AS n
     FROM "Farmer"
     WHERE "campaignSegment" IS NOT NULL AND "campaignSegment" <> 'OTHER' ${cropClause(crop)}
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
}

/** Drill-down: farmers in a store × segment cell (optionally crop-scoped). */
export async function getSegmentCustomers(
  storeId: number | null,
  segment: string,
  crop: CropFilter,
  limit = 500,
): Promise<SegmentCustomer[]> {
  const cropTags =
    crop === "maize" ? ["maize"] : crop === "potato" ? ["potato"] : crop === "both" ? ["maize", "potato"] : undefined;
  const farmers = await prisma.farmer.findMany({
    where: {
      campaignSegment: segment,
      storeId: storeId ?? undefined,
      ...(storeId == null ? { storeId: null } : {}),
      ...(cropTags ? { cropTags: { hasEvery: cropTags } } : {}),
    },
    orderBy: { p12mSpend: "desc" },
    take: limit,
    select: {
      id: true, name: true, mobile: true, village: true, p12mSpend: true, hniGap: true,
      lastMaizeItem: true, lastPotatoItem: true,
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
export interface ProjectVM { id: number; name: string; status: string; audienceCount: number; clusters: ProjectClusterVM[] }

/** Projects with their clusters + de-duplicated live audience (union across clusters). */
export async function listProjects(): Promise<ProjectVM[]> {
  const projects = await prisma.project.findMany({
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
    clusters: p.clusters.map((c) => ({ id: c.id, name: c.name, count: countById.get(c.id) ?? 0 })),
  }));
}

export async function createProject(name: string, clusterIds: number[]): Promise<{ ok: boolean; id?: number; error?: string }> {
  const t = name.trim();
  if (!t) return { ok: false, error: "Give the project a name." };
  if (!clusterIds.length) return { ok: false, error: "Add at least one cluster." };
  try {
    const p = await prisma.project.create({
      data: { title: t, status: "PLANNED", source: "REAL", clusters: { connect: clusterIds.map((id) => ({ id })) } },
    });
    revalidatePath("/campaigns");
    return { ok: true, id: p.id };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Create failed" }; }
}

export async function setProjectClusters(projectId: number, clusterIds: number[]): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.project.update({ where: { id: projectId }, data: { clusters: { set: clusterIds.map((id) => ({ id })) } } });
    revalidatePath("/campaigns");
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Update failed" }; }
}

export async function deleteProject(id: number): Promise<{ ok: boolean; error?: string }> {
  try { await prisma.project.delete({ where: { id } }); revalidatePath("/campaigns"); return { ok: true }; }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Delete failed" }; }
}

/* ─────────────────────────── WF3 · Communication plan ─────────────────────────── */

export async function saveCommTemplate(
  segment: string,
  patch: { medium?: string; offer?: string; timingLabel?: string; template?: string },
): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.commTemplate.update({ where: { segment }, data: patch });
    revalidatePath("/campaigns");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed" };
  }
}

/* ─────────────────────────── WF4 · Campaigns & tracking ─────────────────────────── */

export interface CreateCampaignInput {
  name: string;
  startDate: string; // ISO date
  endDate: string;
  projectId: number; // Step 3: campaign runs on a project…
  clusterId?: number | null; // …or one specific cluster within it (null = whole project)
  testPct?: number;
}

const CLUSTER_SELECT = { id: true, name: true, criteria: true, mode: true, farmerIds: true } as const;

export async function createCampaign(input: CreateCampaignInput): Promise<{ ok: boolean; id?: number; members?: number; error?: string }> {
  try {
    if (!input.name.trim()) return { ok: false, error: "Name is required." };
    if (!input.projectId) return { ok: false, error: "Pick a project." };

    // Resolve the audience id-set — snapshot at launch (a single cluster, or the union of the project's clusters).
    let ids: number[];
    if (input.clusterId) {
      const c = await prisma.cluster.findUnique({ where: { id: input.clusterId }, select: CLUSTER_SELECT });
      if (!c) return { ok: false, error: "Cluster not found." };
      // Guard: the cluster must actually belong to the chosen project.
      const inProject = await prisma.project.findFirst({ where: { id: input.projectId, clusters: { some: { id: c.id } } }, select: { id: true } });
      if (!inProject) return { ok: false, error: "That cluster is not part of the selected project." };
      ids = await clusterIdsOf(c);
    } else {
      const p = await prisma.project.findUnique({ where: { id: input.projectId }, include: { clusters: { select: CLUSTER_SELECT } } });
      if (!p) return { ok: false, error: "Project not found." };
      if (!p.clusters.length) return { ok: false, error: "This project has no clusters." };
      // NB: pass an explicit arrow — `.map(clusterIdsOf)` would feed the array index in as `cap`.
      const sets = await Promise.all(p.clusters.map((c) => clusterIdsOf(c)));
      ids = [...new Set(sets.flat())]; // de-duplicate farmers shared across clusters
    }
    if (!ids.length) return { ok: false, error: "The selected audience is empty right now." };
    // The audience count shown to the user is uncapped; refuse rather than silently
    // enrol only part of a pathologically large audience (see ENROLL_CAP).
    if (ids.length >= ENROLL_CAP) return { ok: false, error: `Audience is too large to enrol in one campaign (${ENROLL_CAP.toLocaleString("en-IN")}+). Narrow the cluster or project first.` };

    const camp = await prisma.campaign.create({
      data: {
        name: input.name.trim(),
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
        projectId: input.projectId,
        clusterId: input.clusterId ?? null,
        testPct: input.testPct ?? 75,
        status: "ACTIVE",
      },
    });

    // Enrol the snapshot, split 75/25 test/control by a deterministic id hash. Fetch segment/crop in chunks.
    const controlEvery = Math.max(2, Math.round(100 / (100 - (input.testPct ?? 75)))); // ~4 for 75/25
    let total = 0;
    for (let i = 0; i < ids.length; i += 5000) {
      const slice = ids.slice(i, i + 5000);
      const farmers = await prisma.farmer.findMany({ where: { id: { in: slice } }, select: { id: true, campaignSegment: true, cropTags: true } });
      const members = farmers.map((f) => ({
        campaignId: camp.id,
        farmerId: f.id,
        segment: f.campaignSegment ?? "OTHER",
        crop: f.cropTags[0] ?? null,
        group: f.id % controlEvery === 0 ? "CONTROL" : "TEST",
      }));
      const res = await prisma.campaignMember.createMany({ data: members, skipDuplicates: true });
      total += res.count;
    }
    revalidatePath("/campaigns");
    return { ok: true, id: camp.id, members: total };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Create failed" };
  }
}

export interface CampaignListItem {
  id: number; name: string; status: string; startDate: string; endDate: string;
  target: string; members: number;
}

export async function listCampaigns(): Promise<CampaignListItem[]> {
  const camps = await prisma.campaign.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { _count: { select: { members: true } } },
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
    target: c.clusterId
      ? `Cluster · ${cName.get(c.clusterId) ?? "removed"}`
      : c.projectId
        ? `Project · ${pName.get(c.projectId) ?? "removed"}`
        : c.targetSegments.map((s) => segMeta(s).label).join(", ") || "—", // legacy segment campaigns
    members: c._count.members,
  }));
}

export interface UpliftRow {
  segment: string;
  test: { farmers: number; reached: number; purchased: number; avg: number };
  control: { farmers: number; purchased: number; avg: number };
  upliftPurchasePct: number; // test%purch − control%purch
  upliftAvg: number;
  incremental: number;
}

/** Uplift dashboard: test vs control, purchases attributed to sales within the window. */
export async function getCampaignUplift(campaignId: number): Promise<UpliftRow[]> {
  const camp = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!camp) return [];
  const members = await prisma.campaignMember.findMany({
    where: { campaignId },
    select: { farmerId: true, segment: true, group: true, reached: true },
  });
  if (!members.length) return [];

  // Sales within the campaign window, per farmer.
  const ids = members.map((m) => m.farmerId);
  const purch = new Map<number, number>(); // farmerId → total ₹ in window
  for (let i = 0; i < ids.length; i += 20000) {
    const rows = await prisma.sale.groupBy({
      by: ["farmerId"],
      where: { farmerId: { in: ids.slice(i, i + 20000) }, soldAt: { gte: camp.startDate, lte: camp.endDate } },
      _sum: { amountNum: true },
    });
    for (const r of rows) purch.set(r.farmerId, r._sum.amountNum ?? 0);
  }

  type Acc = { tF: number; tR: number; tP: number; tSum: number; cF: number; cP: number; cSum: number };
  const bySeg = new Map<string, Acc>();
  for (const m of members) {
    const a = bySeg.get(m.segment) ?? { tF: 0, tR: 0, tP: 0, tSum: 0, cF: 0, cP: 0, cSum: 0 };
    const spend = purch.get(m.farmerId) ?? 0;
    const bought = spend > 0;
    if (m.group === "TEST") { a.tF++; if (m.reached) a.tR++; if (bought) { a.tP++; a.tSum += spend; } }
    else { a.cF++; if (bought) { a.cP++; a.cSum += spend; } }
    bySeg.set(m.segment, a);
  }

  return [...bySeg.entries()].map(([segment, a]) => {
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
      // Incremental ₹ = reached × uplift-in-conversion × test avg order value (rigorous version).
      incremental: Math.round(reachedOrFarmers * upliftPct * testAvg),
    };
  });
}
