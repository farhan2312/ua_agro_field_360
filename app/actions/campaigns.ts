"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { shortStoreName } from "@/lib/store-utils";
import { segMeta, VALUE_SEGMENTS, LIFECYCLE_SEGMENTS } from "@/lib/campaign-segments";
import { inr } from "@/lib/format";
import type { Prisma } from "@prisma/client";
import {
  parseCriteria, resolveClusterCount, resolveClusterIds, scopedCriteriaWhere,
  hasConditions, criteriaCrops, type ClusterCriteria,
} from "@/lib/cluster-rules";
import { clusterCampaignLock, clusterCampaignLocks } from "@/lib/cluster-locks";
import { explicitClusterIds, resolveCampaignClusters } from "@/lib/campaign-clusters";
import { applyCampaignTeam, readCampaignTeam, teamCandidates, campaignFieldAccess, type TeamOfficer, type TeamCampaigner } from "@/lib/campaign-team";
import { getScope, canManage, getActor, farmerScopeWhere } from "@/lib/scope";
import { asCoupons } from "@/lib/campaign-phases";
import { logAudit } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { cropLabel } from "@/lib/crops";
import { locVal, locMatcher, locItemsOf, sanitizeLoc, locSummary, locLabel, type LocFilter, type LocItem } from "@/lib/campaign-location";
import { buildWorkbookB64, type Cell } from "@/lib/xlsx-export";
import { loadPrevRounds, earlierReached } from "@/lib/campaign-member-rounds";
import type { PrevRoundContact } from "@/lib/campaign-prev-round";
import { buildStyledWorkbookB64, type StyledSheetSpec, type StyledCell } from "@/lib/xlsx-styled";
import { sendSms, zapConfig, listSmsTemplates, type SmsTemplate } from "@/lib/zapsms";
import { sendWhatsApp, waConfig, waCreateTemplate } from "@/lib/whatsapp";
import { SAMPLE_VARS, resolveVars, fillDltTemplate, fillWaTemplate, positionalParams, countDltVars, VAR_LABEL, type FarmerVarSource } from "@/lib/campaign-vars";

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
  const [rows, storeRows] = await Promise.all([
    prisma.$queryRawUnsafe<{ crop: string; n: number }[]>(
      `SELECT unnest("cropTags") crop, COUNT(*)::int n FROM "Farmer" WHERE source='REAL' AND array_length("cropTags",1) > 0 GROUP BY 1 ORDER BY 2 DESC`,
    ),
    prisma.$queryRawUnsafe<{ crop: string }[]>(`SELECT DISTINCT unnest("cropTags") crop FROM "Store"`),
  ]);
  // Crops set only on stores (no sales/visit evidence yet) still need to be pickable — count 0.
  const seen = new Set(rows.map((r) => r.crop));
  return [...rows.map((r) => ({ crop: r.crop, count: Number(r.n) })), ...storeRows.filter((r) => !seen.has(r.crop)).map((r) => ({ crop: r.crop, count: 0 }))];
}

/** Distinct Target Pests/Diseases/Weeds across farmers (item-code derived), most common first. */
export async function getPestOptions(): Promise<{ pest: string; count: number }[]> {
  const rows = await prisma.$queryRawUnsafe<{ pest: string; n: number }[]>(
    `SELECT unnest("pestTags") pest, COUNT(*)::int n FROM "Farmer" WHERE source='REAL' AND array_length("pestTags",1) > 0 GROUP BY 1 ORDER BY 2 DESC LIMIT 200`,
  );
  return rows.map((r) => ({ pest: r.pest, count: Number(r.n) }));
}

/* The old unscoped store×segment matrix + its drill-down (`getSegmentMatrix`,
   `getSegmentCustomers`) were removed with the officer/RM RBAC work: the analytics
   workbench replaced them, and as "use server" exports they stayed callable by any
   signed-in user — returning farmers (with phone numbers) from ANY store. The scoped
   equivalents live in app/actions/analytics-segments.ts (getWorkbench*). */

/* ─────────────────────────── Clusters (Step 1) ─────────────────────────── */

export interface ClusterVM {
  id: number;
  name: string;
  description: string;
  count: number;
  origin: string;
  mode: string;
  createdBy: string;
  createdByCode: string;
  createdAt: string; // ISO — when the cluster was created
  criteria: ClusterCriteria | null; // the parsed filter rule (for the edit modal; null = legacy/unparseable)
  locked: boolean; // frozen — feeds a live (non-CLOSED) campaign, so it can't be edited or deleted
  lockedBy: string | null; // name of a campaign holding the lock (for the UI message)
}

/** All saved clusters with LIVE counts (dynamic clusters re-resolve their rule). */
export async function listClustersWithCounts(): Promise<ClusterVM[]> {
  // RBAC: regional managers see clusters through their region only — the count is the
  // in-region membership, and clusters with nobody in their region are hidden entirely.
  const scope = await getScope();
  const fScope = farmerScopeWhere(scope);
  if (fScope === "none") return [];

  const clusters = await prisma.cluster.findMany({
    where: { source: "REAL" }, // demo clusters must not be bundleable into real projects/campaigns
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, name: true, description: true, criteria: true, mode: true, origin: true, farmerIds: true, createdBy: true, createdByCode: true, createdAt: true },
  });
  // Which of these clusters are frozen by a live campaign (so the UI hides Edit/Delete). One query.
  const locks = await clusterCampaignLocks(clusters.map((c) => c.id));
  const rows = await mapLimit(clusters, 8, async (c) => {
    const crit = c.mode === "dynamic" ? parseCriteria(c.criteria) : null;
    const base: Prisma.FarmerWhereInput = crit ? scopedCriteriaWhere(crit) : { source: "REAL", id: { in: c.farmerIds } };
    const count = fScope
      ? await prisma.farmer.count({ where: { AND: [base, fScope] } })
      : crit
        ? await resolveClusterCount(crit)
        : c.farmerIds.length;
    return {
      id: c.id,
      name: c.name,
      description: c.description ?? "—",
      count,
      origin: c.origin ?? "map",
      mode: c.mode,
      createdBy: c.createdBy ?? "",
      createdByCode: c.createdByCode ?? "",
      createdAt: c.createdAt.toISOString(),
      criteria: parseCriteria(c.criteria), // full parsed rule (any mode) so the edit modal can prefill
      locked: locks.has(c.id),
      lockedBy: locks.get(c.id) ?? null,
    };
  });
  return fScope ? rows.filter((r) => r.count > 0) : rows;
}

/** Live count preview for the cluster rule builder (0 for an empty rule). */
export async function previewClusterCount(criteria: ClusterCriteria): Promise<number> {
  if (!hasConditions(criteria)) return 0;
  return resolveClusterCount(criteria);
}

export async function deleteCluster(id: number): Promise<{ ok: boolean; error?: string }> {
  const perm = await requireManager(); if (!perm.ok) return perm; // RMs/officers may view clusters, not delete them
  // A cluster feeding a live campaign is frozen — deleting it would leave the campaign pointing at nothing.
  const lock = await clusterCampaignLock(id);
  if (lock) return { ok: false, error: `This cluster is used by the active campaign “${lock}”. Close that campaign before deleting the cluster.` };
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

/**
 * Live audience for a campaign being set up on a chosen set of a project's clusters (empty = all):
 * `audience` = de-duplicated union; `already` = of those, farmers already in another campaign of this
 * project (createCampaign skips them).
 */
export async function previewCampaignAudience(projectId: number, clusterIds: number[]): Promise<{ ok: boolean; audience?: number; already?: number; storeIds?: number[]; error?: string }> {
  const perm = await requireManager(); if (!perm.ok) return perm;
  const project = await prisma.project.findUnique({ where: { id: projectId }, include: { clusters: { select: CLUSTER_SELECT } } });
  if (!project) return { ok: false, error: "Project not found." };
  const picked = new Set(clusterIds);
  const chosen = picked.size ? project.clusters.filter((c) => picked.has(c.id)) : project.clusters;
  if (!chosen.length) return { ok: true, audience: 0, already: 0, storeIds: [] };
  const union: Prisma.FarmerWhereInput = { OR: chosen.map(clusterWhere) };
  const enrolled = await prisma.campaignMember.findMany({ where: { campaign: { projectId } }, select: { farmerId: true }, distinct: ["farmerId"] });
  const [audience, already, stores] = await Promise.all([
    prisma.farmer.count({ where: union }),
    enrolled.length ? prisma.farmer.count({ where: { AND: [union, { id: { in: enrolled.map((e) => e.farmerId) } }] } }) : Promise.resolve(0),
    prisma.farmer.groupBy({ by: ["storeId"], where: { AND: [union, { storeId: { not: null } }] } }), // drives the default team
  ]);
  return { ok: true, audience, already, storeIds: stores.map((s) => s.storeId!).filter((x) => x != null) };
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
  name?: string; language?: string; promoType?: string;
  segments?: string[]; // target segments (value + lifecycle); EMPTY = All
  medium?: string; offer?: string; timingLabel?: string; template?: string;
  dltTemplateId?: string | null;
  waTemplateName?: string | null;
  waLanguage?: string | null;
  waVariables?: string[];
  smsVariables?: string[];
}

/** Keep the legacy single `segment` column in sync with segments[0] (or a sensible default). */
const legacySeg = (segments?: string[]) => (segments && segments.length ? segments[0] : "REGULAR");

export async function saveCommTemplate(id: number, patch: CommTemplatePatch): Promise<{ ok: boolean; error?: string }> {
  const perm = await requireManager(); if (!perm.ok) return perm; // central-only config (read-only for officers/RMs)
  if (patch.name !== undefined && !patch.name.trim()) return { ok: false, error: "Give the comm plan a name." };
  try {
    const data: Prisma.CommTemplateUpdateInput = { ...patch };
    if (patch.segments !== undefined) data.segment = legacySeg(patch.segments);
    await prisma.commTemplate.update({ where: { id }, data });
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
    const row = await prisma.commTemplate.create({ data: { ...data, segment: legacySeg(data.segments), name: data.name.trim(), priority: 5 } });
    revalidatePath("/campaigns");
    return { ok: true, id: row.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Create failed" };
  }
}

export interface SmsTemplateVM extends SmsTemplate {}
/** Approved DLT SMS templates from the ZapSMS account (for the Comm Plan picker). Manager-only. */
export async function getSmsTemplates(): Promise<{ ok: boolean; templates: SmsTemplateVM[]; error?: string }> {
  const perm = await requireManager(); if (!perm.ok) return { ok: false, templates: [], error: perm.error };
  const r = await listSmsTemplates();
  // Prefer approved-and-active first, then approved, then the rest — all usable, but the good ones lead.
  const rank = (t: SmsTemplate) => (t.approved && t.active ? 0 : t.approved ? 1 : 2);
  const templates = [...r.templates].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return { ok: r.ok, templates, error: r.error };
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
  clusterIds?: number[]; // …or any set of its clusters (empty / every cluster = whole project)
  commPlans: string[]; // comm-plan names this campaign is tagged with (1+ required)
  testPct?: number;
  workedBy?: "STORE" | "CAMPAIGNERS" | "BOTH"; // legacy rule (only when no `team` is given)
  team?: { officerIds: number[]; campaignerIds: number[] }; // the picked "who works this campaign" team
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

    // Resolve the audience id-set — the union of the chosen clusters (or all of the project's).
    if (!project.clusters.length) return { ok: false, error: "This project has no clusters." };
    const picked = [...new Set(input.clusterIds ?? [])];
    if (picked.some((id) => !project.clusters.some((c) => c.id === id))) return { ok: false, error: "A selected cluster is not part of this project." };
    const wholeProject = picked.length === 0 || picked.length === project.clusters.length;
    const chosen = wholeProject ? project.clusters : project.clusters.filter((c) => picked.includes(c.id));
    const sets = await mapLimit(chosen, 4, (c) => clusterIdsOf(c));
    let ids = [...new Set(sets.flat())]; // de-duplicate farmers shared across clusters
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
      data: { name: input.name.trim(), startDate: cs, endDate: ce, projectId: input.projectId,
        clusterIds: wholeProject ? [] : chosen.map((c) => c.id), clusterId: !wholeProject && chosen.length === 1 ? chosen[0].id : null, commPlans, testPct: input.testPct ?? 75, status: "ACTIVE", workedBy: ["STORE", "CAMPAIGNERS", "BOTH"].includes(input.workedBy ?? "") ? input.workedBy! : "STORE" },
    });

    // Enrol snapshot; store/zone denormalized so officers/RMs see only their own farmers.
    // Test/control split chosen by the maker: ~testPct% of the audience is TEST (contacted), the rest
    // control. Deterministic by farmer id mod 100 → an even split that holds for any ratio (not just 75/25).
    const testPct = Math.min(100, Math.max(0, Math.round(input.testPct ?? 75))); // 0 = all control, 100 = all test
    let total = 0;
    for (let i = 0; i < ids.length; i += 5000) {
      const slice = ids.slice(i, i + 5000);
      const farmers = await prisma.farmer.findMany({ where: { id: { in: slice } }, select: { id: true, campaignSegment: true, valueSegment: true, lifecycleSegment: true, cropTags: true, storeId: true, zone: true } });
      const members = farmers.map((f) => ({
        campaignId: camp.id, farmerId: f.id, segment: f.campaignSegment ?? "OTHER",
        valueSegment: f.valueSegment, lifecycleSegment: f.lifecycleSegment,
        crop: f.cropTags[0] ?? null, storeId: f.storeId ?? null, zone: f.zone ?? null,
        group: (f.id % 100) < testPct ? "TEST" : "CONTROL",
      }));
      const res = await prisma.campaignMember.createMany({ data: members, skipDuplicates: true });
      total += res.count;
    }
    if (input.team) {
      const err = await applyCampaignTeam(camp.id, input.team.officerIds ?? [], input.team.campaignerIds ?? [], await getActor());
      if (err) return { ok: false, id: camp.id, members: total, error: `Campaign created, but the team wasn't saved: ${err} Fix it from the campaign's Edit.` };
    }
    await logAudit("Campaign", "CREATE", `Created campaign "${camp.name}" — ${total} farmers enrolled${skipped ? `, ${skipped} skipped` : ""}${input.team ? ` · team: ${input.team.officerIds.length} officers, ${input.team.campaignerIds.length} campaigners` : ""}`);
    revalidatePath("/campaigns");
    return { ok: true, id: camp.id, members: total, skipped };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Create failed" };
  }
}

/** Extend a campaign's end date (central only). Cannot exceed the project's end — extend the project first. */
export async function extendCampaign(campaignId: number, newEndDate: string): Promise<{ ok: boolean; error?: string }> {
  const perm = await requireManager(); if (!perm.ok) return perm;
  const camp = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { name: true, endDate: true, projectId: true } });
  if (!camp) return { ok: false, error: "Campaign not found." };
  const nd = new Date(newEndDate);
  if (!(nd > camp.endDate)) return { ok: false, error: `New end must be after the current end (${iso(camp.endDate)}).` };
  if (camp.projectId) {
    const p = await prisma.project.findUnique({ where: { id: camp.projectId }, select: { endDate: true } });
    if (p?.endDate && nd > p.endDate) return { ok: false, error: `Can't extend past the project end (${iso(p.endDate)}). Extend the project first.` };
  }
  try {
    await prisma.campaign.update({ where: { id: campaignId }, data: { endDate: nd } });
    await logAudit("Campaign", "UPDATE", `Extended campaign "${camp.name}" end date → ${iso(nd)}`);
    revalidatePath("/campaigns");
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Extend failed" }; }
}

/**
 * Submit a WhatsApp comm plan's message to Meta as a template for approval (manager-only). The plan's
 * message body IS the template; {{n}} example values come from the variable mapping's samples. On success
 * the derived Meta template name + language are stored back on the plan.
 */
export async function submitCommPlanForApproval(id: number): Promise<{ ok: boolean; status?: string; name?: string; error?: string }> {
  const perm = await requireManager(); if (!perm.ok) return perm;
  const t = await prisma.commTemplate.findUnique({ where: { id } });
  if (!t) return { ok: false, error: "Comm plan not found." };
  const body = (t.template ?? "").trim();
  if (!body) return { ok: false, error: "Add a message before submitting for approval." };
  const metaName = (t.name || `plan_${id}`).toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  const language = (t.waLanguage || (t.language === "hi" ? "hi" : "en")).trim();
  const category = t.promoType === "Reminder" ? "UTILITY" : "MARKETING";
  // Example values for each {{n}}, from the mapped farmer field's sample (Meta requires an example per variable).
  const examples = (t.waVariables ?? []).map((tok) => SAMPLE_VARS[tok] ?? "Sample");
  const res = await waCreateTemplate({ name: metaName, language, category, body, examples });
  if (!res.ok) return { ok: false, error: res.error ?? "Meta rejected the submission." };
  await prisma.commTemplate.update({ where: { id }, data: { waTemplateName: metaName, waLanguage: language } });
  revalidatePath("/campaigns");
  return { ok: true, status: res.status, name: metaName };
}

/** Add/remove the comm plans a campaign is tagged with (manager-only). Must keep at least one. */
export async function updateCampaignCommPlans(campaignId: number, commPlans: string[]): Promise<{ ok: boolean; error?: string }> {
  const perm = await requireManager(); if (!perm.ok) return perm;
  const camp = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { name: true } });
  if (!camp) return { ok: false, error: "Campaign not found." };
  const clean = [...new Set((commPlans ?? []).map((s) => s.trim()).filter(Boolean))];
  if (!clean.length) return { ok: false, error: "Tag at least one comm plan." };
  try {
    await prisma.campaign.update({ where: { id: campaignId }, data: { commPlans: clean } });
    await logAudit("Campaign", "UPDATE", `Updated comm plans for "${camp.name}": ${clean.join(", ")}`);
    revalidatePath("/campaigns");
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Update failed" }; }
}

/** Everyone who can be put on a campaign team: active Agri Officers (with their store) and Campaigners. Manager-only. */
export async function getTeamCandidates(): Promise<{ ok: boolean; officers?: TeamOfficer[]; campaigners?: TeamCampaigner[]; error?: string }> {
  const perm = await requireManager(); if (!perm.ok) return perm;
  return { ok: true, ...(await teamCandidates()) };
}

/** A campaign's current team (legacy campaigns: reconstructed from the old store rule). Manager-only. */
export async function getCampaignTeam(campaignId: number): Promise<{ ok: boolean; officerIds?: number[]; campaignerIds?: number[]; storeIds?: number[]; error?: string }> {
  const perm = await requireManager(); if (!perm.ok) return perm;
  const t = await readCampaignTeam(Number(campaignId));
  return t ? { ok: true, officerIds: t.officerIds, campaignerIds: t.campaignerIds, storeIds: t.storeIds } : { ok: false, error: "Campaign not found." };
}

/** Replace who works a campaign (picked officers + campaigners). Manager-only. */
export async function setCampaignTeam(campaignId: number, officerIds: number[], campaignerIds: number[]): Promise<{ ok: boolean; error?: string }> {
  const perm = await requireManager(); if (!perm.ok) return perm;
  const camp = await prisma.campaign.findUnique({ where: { id: Number(campaignId) }, select: { id: true, name: true } });
  if (!camp) return { ok: false, error: "Campaign not found." };
  if (!officerIds.length && !campaignerIds.length) return { ok: false, error: "Pick at least one person to work this campaign." };
  try {
    const err = await applyCampaignTeam(camp.id, officerIds, campaignerIds, await getActor());
    if (err) return { ok: false, error: err };
    await logAudit("Campaign", "UPDATE", `Set the team for "${camp.name}": ${officerIds.length} officers, ${campaignerIds.length} campaigners`);
    revalidatePath("/campaigns");
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Update failed" }; }
}

/** Change who works a campaign — STORE (officers/RMs), CAMPAIGNERS (hidden from officers), or BOTH. Manager-only. */
export async function setCampaignWorkedBy(campaignId: number, workedBy: string): Promise<{ ok: boolean; error?: string }> {
  const perm = await requireManager(); if (!perm.ok) return perm;
  if (!["STORE", "CAMPAIGNERS", "BOTH"].includes(workedBy)) return { ok: false, error: "Invalid option." };
  const camp = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { name: true } });
  if (!camp) return { ok: false, error: "Campaign not found." };
  try {
    await prisma.campaign.update({ where: { id: campaignId }, data: { workedBy } });
    await logAudit("Campaign", "UPDATE", `Set who works "${camp.name}" to ${workedBy}`);
    revalidatePath("/campaigns");
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Update failed" }; }
}

/**
 * Delete a campaign and everything scoped to it: members, phases, phase-advances and caller
 * assignments cascade at the DB; broadcasts (+ their recipients) are cleared explicitly since they
 * key off campaignId without an FK. SMS/WhatsApp audit logs are KEPT (real message history).
 */
export async function deleteCampaign(campaignId: number): Promise<{ ok: boolean; error?: string }> {
  const perm = await requireManager(); if (!perm.ok) return perm;
  const camp = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { name: true } });
  if (!camp) return { ok: false, error: "Campaign not found." };
  try {
    await prisma.broadcastRecipient.deleteMany({ where: { broadcast: { campaignId } } });
    await prisma.broadcast.deleteMany({ where: { campaignId } });
    await prisma.campaign.delete({ where: { id: campaignId } }); // cascades members/phases/advances/callers
    await logAudit("Campaign", "DELETE", `Deleted campaign "${camp.name}"`);
    revalidatePath("/campaigns");
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Delete failed" }; }
}

export interface CampaignListItem {
  id: number; name: string; status: string; startDate: string; endDate: string;
  target: string; members: number;
  commPlans: string[]; // comm-plan names the campaign is tagged with
  workedBy: string; // STORE | CAMPAIGNERS | BOTH — who sees + works this campaign
  team: boolean; // true = a picked team (CampaignWorker / CampaignCaller) decides who works it
}

/** Member `where` for the current user's scope (officer→their store, RM→their managed stores). null = see all. */
async function memberScopeWhere(): Promise<Prisma.CampaignMemberWhereInput | null | "none"> {
  const { role, storeId, managedStoreIds } = await getScope();
  if (role === "officer") return storeId == null ? "none" : { storeId };
  if (role === "regional") return managedStoreIds && managedStoreIds.length ? { storeId: { in: managedStoreIds } } : "none";
  return null; // central / sysadmin / campaigner (campaigner is gated at the campaign level, see below)
}

/**
 * Campaign ids a Campaigner is assigned to call. Returns `null` when the current user is NOT a
 * campaigner (i.e. don't apply campaign-level gating); an array (possibly empty) when they are.
 */
async function campaignerAssignedIds(): Promise<number[] | null> {
  const { role, userId } = await getScope();
  if (role !== "campaigner") return null;
  if (userId == null) return [];
  const rows = await prisma.campaignCaller.findMany({ where: { userId }, select: { campaignId: true } });
  return rows.map((r) => r.campaignId);
}

/**
 * Member `where` for the current user on ONE campaign (see campaignFieldAccess). null = see all (central/
 * sysadmin/campaigner — campaigner gated separately — or an officer added to the whole campaign);
 * "none" = see nothing.
 */
async function campaignMemberScope(campaignId: number): Promise<Prisma.CampaignMemberWhereInput | null | "none"> {
  const { role } = await getScope();
  if (role === "officer" || role === "regional") {
    const access = await campaignFieldAccess(campaignId);
    if (access === "all") return null;
    return access.length ? { storeId: { in: access } } : "none";
  }
  return null; // central / sysadmin / campaigner
}

export async function listCampaigns(): Promise<CampaignListItem[]> {
  const { role, userId, storeId, managedStoreIds } = await getScope();

  // Per-role campaign filter + member-count filter (same rules as campaignFieldAccess). RMs see campaigns that
  // reach their stores; officers see legacy campaigns reaching their store or the picked-team campaigns
  // they're on; both also see any campaign they've been lent to as a helper (named stores).
  let where: Prisma.CampaignWhereInput | undefined;
  let countWhere: Prisma.CampaignMemberWhereInput | undefined; // undefined = count every member
  let wholeIds = new Set<number>(); // officer added to the whole campaign → count every member

  if (role === "campaigner") {
    const rows = userId != null ? await prisma.campaignCaller.findMany({ where: { userId }, select: { campaignId: true } }) : [];
    const assigned = rows.map((r) => r.campaignId);
    if (!assigned.length) return []; // campaigner with nothing assigned yet
    where = { id: { in: assigned } };
  } else if (role === "officer" || role === "regional") {
    const ownStores = role === "officer" ? (storeId != null ? [storeId] : []) : (managedStoreIds ?? []);
    const helperRows = userId != null
      ? await prisma.campaignHelper.findMany({ where: { userId }, select: { campaignId: true, storeIds: true } })
      : [];
    const helperIds = helperRows.map((r) => r.campaignId);
    const helperStores = [...new Set(helperRows.flatMap((r) => r.storeIds))];
    const allStores = [...new Set([...ownStores, ...helperStores])];
    const workerRows = role === "officer" && userId != null
      ? await prisma.campaignWorker.findMany({ where: { userId }, select: { campaignId: true, allStores: true } })
      : [];
    wholeIds = new Set(workerRows.filter((r) => r.allStores).map((r) => r.campaignId));
    if (!allStores.length && !helperIds.length && !workerRows.length) return []; // no store, no grant, no team spot → nothing
    const or: Prisma.CampaignWhereInput[] = [];
    const reachesOwn: Prisma.CampaignWhereInput = { members: { some: { storeId: { in: ownStores } } } };
    if (ownStores.length) {
      if (role === "regional") or.push({ ...reachesOwn, OR: [{ teamExplicit: true }, { workedBy: { in: ["STORE", "BOTH"] } }] });
      else or.push({ ...reachesOwn, teamExplicit: false, workedBy: { in: ["STORE", "BOTH"] } }); // legacy store rule
    }
    if (workerRows.length) or.push({ id: { in: workerRows.map((r) => r.campaignId) } }); // picked into the team
    if (helperIds.length) or.push({ id: { in: helperIds } }); // explicit helper grant overrides workedBy
    where = or.length ? { OR: or } : { id: { in: [] } };
    countWhere = { storeId: { in: allStores.length ? allStores : [-1] } }; // count only members they can see
  } // central / sysadmin: where + countWhere stay undefined (everything)

  const camps = await prisma.campaign.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    where,
    include: { _count: { select: { members: countWhere ? { where: countWhere } : true } } }, // scoped member count
  });
  if (wholeIds.size) { // whole-campaign team members see (and count) every member
    const full = await prisma.campaignMember.groupBy({ by: ["campaignId"], where: { campaignId: { in: [...wholeIds] } }, _count: { _all: true } });
    const fullBy = new Map(full.map((f) => [f.campaignId, f._count._all]));
    for (const c of camps) if (fullBy.has(c.id)) c._count.members = fullBy.get(c.id)!;
  }
  // Batch-resolve target names (loose ids — campaigns don't relation-load project/cluster).
  const projIds = [...new Set(camps.map((c) => c.projectId).filter((x): x is number => x != null))];
  const clusIds = [...new Set(camps.flatMap((c) => explicitClusterIds(c) ?? []))];
  const [projs, clus] = await Promise.all([
    projIds.length ? prisma.project.findMany({ where: { id: { in: projIds } }, select: { id: true, title: true } }) : Promise.resolve([]),
    clusIds.length ? prisma.cluster.findMany({ where: { id: { in: clusIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const pName = new Map(projs.map((p) => [p.id, p.title]));
  const cName = new Map(clus.map((c) => [c.id, c.name]));
  const clusterLabel = (ids: number[]) => {
    const names = ids.map((id) => cName.get(id) ?? "removed");
    return ids.length === 1 ? `Cluster · ${names[0]}` : `${ids.length} clusters · ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3} more` : ""}`;
  };
  return camps.map((c) => ({
    id: c.id, name: c.name, status: c.status,
    startDate: c.startDate.toISOString().slice(0, 10),
    endDate: c.endDate.toISOString().slice(0, 10),
    commPlans: c.commPlans,
    workedBy: c.workedBy,
    team: c.teamExplicit,
    target: explicitClusterIds(c)
      ? clusterLabel(explicitClusterIds(c)!)
      : c.projectId
        ? `Project · ${pName.get(c.projectId) ?? "removed"}`
        : c.targetSegments.map((s) => segMeta(s).label).join(", ") || "—", // legacy segment campaigns
    members: c._count.members,
  }));
}

/** Scoped enrolled-farmer list for a campaign — TEST group only (the CONTROL holdout is never contacted). */
export interface CampaignMemberVM {
  id: number; name: string; mobile: string | null; village: string | null; storeId: number | null; store: string | null;
  district: string | null; region: string | null; // region = enrolled store's zone; district/village from the farmer (normalised)
  segment: string; valueSegment: string | null; reached: boolean; mediums: string[]; comment: string | null; reachedAt: string | null;
  reachedBy: string | null; reachedByCode: string | null;
  response: string | null; responseCrop: string | null; // interest outcome + the crop when OTHER_CROP
  broadcastMediums: string[]; // channels DELIVERED via mass send (separate from `reached`)
  prev: PrevRoundContact[]; // what happened with this farmer in earlier rounds (round 2+), oldest first
}
// Load the whole TEST group so the outreach counts (to-contact / reached / left) are accurate — the old
// 1000 default capped a 2k+ campaign's list. Bounded to keep the payload sane; huge campaigns use the matrix.
export async function getCampaignMembers(campaignId: number, limit = 25000): Promise<CampaignMemberVM[]> {
  const assigned = await campaignerAssignedIds();
  if (assigned && !assigned.includes(campaignId)) return []; // campaigner may only open assigned campaigns
  const scope = await campaignMemberScope(campaignId); // own store/zone + any helper grant on this campaign
  if (scope === "none") return [];
  const members = await prisma.campaignMember.findMany({
    where: { campaignId, group: "TEST", ...(scope ?? {}) }, // officers/RMs contact only the TEST group
    take: limit, orderBy: { id: "asc" },
    select: { id: true, farmerId: true, segment: true, valueSegment: true, reached: true, mediums: true, comment: true, reachedAt: true, reachedBy: true, reachedByCode: true, storeId: true, response: true, responseCrop: true, broadcastMediums: true },
  });
  if (!members.length) return [];
  const [farmers, stores] = await Promise.all([
    prisma.farmer.findMany({ where: { id: { in: members.map((m) => m.farmerId) } }, select: { id: true, name: true, mobile: true, village: true, district: true } }),
    prisma.store.findMany({ select: { id: true, name: true, zone: true } }),
  ]);
  const fMap = new Map(farmers.map((f) => [f.id, f]));
  const sMap = new Map(stores.map((s) => [s.id, shortStoreName(s.name)]));
  const zMap = new Map(stores.map((s) => [s.id, locVal(s.zone)]));
  // Earlier-round conversations (only once the campaign has moved past round 1).
  const camp = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { currentRound: true } });
  const prev = await loadPrevRounds(campaignId, camp?.currentRound ?? 1, scope ? members.map((m) => m.id) : undefined);
  return members.map((m) => {
    const f = fMap.get(m.farmerId);
    return {
      id: m.id, name: f?.name ?? `Farmer #${m.farmerId}`, mobile: f?.mobile ?? null, village: locVal(f?.village),
      district: locVal(f?.district), region: m.storeId != null ? zMap.get(m.storeId) ?? null : null,
      storeId: m.storeId, store: m.storeId != null ? sMap.get(m.storeId) ?? null : null,
      segment: m.segment, valueSegment: m.valueSegment, reached: m.reached, mediums: m.mediums, comment: m.comment, reachedAt: iso(m.reachedAt),
      reachedBy: m.reachedBy, reachedByCode: m.reachedByCode, response: m.response, responseCrop: m.responseCrop,
      broadcastMediums: m.broadcastMediums,
      prev: prev.get(m.id) ?? [],
    };
  });
}

/**
 * Export the full per-farmer outreach log for a campaign (manager-only) — one row per enrolled farmer
 * with everything done to them: channels (call/SMS/WhatsApp/in-person), interest response, mass-send
 * delivery, actual SMS/WhatsApp send counts, who reached them + when, and the working comment.
 */
export async function exportCampaignTrackerXlsx(campaignId: number, campaignName: string, locIn?: LocFilter): Promise<{ ok: boolean; filename?: string; b64?: string; error?: string }> {
  const perm = await requireManager(); if (!perm.ok) return perm;
  const loc = sanitizeLoc(locIn); // optional Region/District/Village filter (same as the tracker screen)
  const allMembers = await prisma.campaignMember.findMany({
    where: { campaignId },
    orderBy: [{ group: "asc" }, { id: "asc" }],
    select: { id: true, farmerId: true, group: true, segment: true, valueSegment: true, lifecycleSegment: true, storeId: true, reached: true, mediums: true, response: true, responseCrop: true, comment: true, reachedBy: true, reachedByCode: true, reachedAt: true, broadcastMediums: true },
    take: 100000,
  });
  if (!allMembers.length) return { ok: false, error: "No enrolled farmers to export." };

  const [farmers, stores, phases, smsLogs, waLogs, camp] = await Promise.all([
    prisma.farmer.findMany({ where: { id: { in: allMembers.map((m) => m.farmerId) } }, select: { id: true, name: true, mobile: true, village: true, district: true } }),
    prisma.store.findMany({ select: { id: true, code: true, name: true, regionalManager: true, zone: true } }),
    prisma.campaignPhase.findMany({ where: { campaignId }, orderBy: { ordinal: "asc" }, select: { ordinal: true, name: true, type: true, defaultStart: true, defaultEnd: true, coupons: true } }),
    prisma.smsLog.findMany({ where: { campaignId, memberId: { not: null } }, select: { memberId: true, createdAt: true } }),
    prisma.whatsAppLog.findMany({ where: { campaignId, memberId: { not: null } }, select: { memberId: true, createdAt: true } }),
    prisma.campaign.findUnique({ where: { id: campaignId }, select: { startDate: true, endDate: true, currentRound: true } }),
  ]);
  const fMap = new Map(farmers.map((f) => [f.id, f]));
  // Finished-round outcomes (saved when the campaign advanced) — the live outcome is the current round's.
  const snaps = await prisma.campaignMemberRound.findMany({ where: { campaignId }, orderBy: { round: "asc" } });
  const snapBy = new Map(snaps.map((r) => [`${r.memberId}:${r.round}`, r]));
  const snapsOf = new Map<number, typeof snaps>();
  for (const r of snaps) (snapsOf.get(r.memberId) ?? snapsOf.set(r.memberId, []).get(r.memberId)!).push(r);
  const earlierReachedIds = new Set(snaps.filter((r) => r.reached).map((r) => r.memberId));
  const curRound = camp?.currentRound ?? 1;
  const sMap = new Map(stores.map((s) => [s.id, shortStoreName(s.name) || s.name]));
  const rmMap = new Map(stores.map((s) => [s.id, (s.regionalManager ?? "").trim()]));
  const codeMap = new Map(stores.map((s) => [s.id, s.code]));
  const zoneMap = new Map(stores.map((s) => [s.id, locVal(s.zone)]));
  // Location of a member: village + district from the farmer, region = enrolled store's zone.
  const locOf = (m: { farmerId: number; storeId: number | null }) => {
    const f = fMap.get(m.farmerId);
    return { village: locVal(f?.village), district: locVal(f?.district), region: m.storeId != null ? zoneMap.get(m.storeId) ?? null : null };
  };
  const inLoc = locMatcher(loc);
  const members = loc ? allMembers.filter((m) => inLoc(locOf(m))) : allMembers;
  if (!members.length) return { ok: false, error: "No enrolled farmers match the location filter." };
  const locCols = (m: { farmerId: number; storeId: number | null }): string[] => { const l = locOf(m); return [l.village ?? "", l.district ?? "", l.region ?? ""]; };

  const MED: Record<string, string> = { CALL: "Call", WHATSAPP: "WhatsApp", SMS: "SMS", IN_PERSON: "In-person", UNREACHABLE: "Unreachable" };
  const RESP: Record<string, string> = { INTERESTED: "Interested", NOT_INTERESTED: "Not interested", OTHER_CROP: "Other crop" };
  const fmtTs = (d: Date | null) => (d ? new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 16).replace("T", " ") : "");
  const fmtDay = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const store = (id: number | null) => (id != null ? sMap.get(id) ?? "" : "");
  const rm = (id: number | null) => (id != null ? rmMap.get(id) ?? "" : "");
  const storeCode = (id: number | null) => (id != null ? codeMap.get(id) ?? "" : "");

  // Round attribution for timestamped sends: which phase window contains a send/date.
  const roundOf = (d: Date): number | null => phases.find((p) => d >= p.defaultStart && d <= p.defaultEnd)?.ordinal ?? null;
  const smsTotal = new Map<number, number>(), waTotal = new Map<number, number>();
  const smsByRound = new Map<string, number>(), waByRound = new Map<string, number>(); // key `${memberId}:${ordinal}`
  for (const l of smsLogs) { if (l.memberId == null) continue; smsTotal.set(l.memberId, (smsTotal.get(l.memberId) ?? 0) + 1); const o = roundOf(l.createdAt); if (o != null) { const k = `${l.memberId}:${o}`; smsByRound.set(k, (smsByRound.get(k) ?? 0) + 1); } }
  for (const l of waLogs) { if (l.memberId == null) continue; waTotal.set(l.memberId, (waTotal.get(l.memberId) ?? 0) + 1); const o = roundOf(l.createdAt); if (o != null) { const k = `${l.memberId}:${o}`; waByRound.set(k, (waByRound.get(k) ?? 0) + 1); } }

  const test = members.filter((m) => m.group === "TEST");
  const count = (pred: (m: typeof members[number]) => boolean) => test.filter(pred).length;
  type Mem = typeof members[number];
  /** Reached in the current round OR any earlier one (tracker reach/uplift are cumulative across rounds). */
  const everReached = (m: Mem) => m.reached || earlierReachedIds.has(m.id);
  /** The outcome a member had in round `ord`: its saved snapshot, or the live outcome for the round it belongs to
   *  (current round once the campaign has advanced; before that, the round whose window holds the date). */
  const recIn = (m: Mem, ord: number) => {
    const sn = snapBy.get(`${m.id}:${ord}`);
    if (sn) return { reached: sn.reached, response: sn.response, comment: sn.comment, reachedAt: sn.reachedAt, reachedBy: sn.reachedBy, reachedByCode: sn.reachedByCode };
    if (!m.reachedAt) return null;
    const liveRound = curRound > 1 ? curRound : roundOf(m.reachedAt);
    return liveRound === ord ? { reached: m.reached, response: m.response, comment: m.comment, reachedAt: m.reachedAt, reachedBy: m.reachedBy, reachedByCode: m.reachedByCode } : null;
  };
  const earlierText = (m: Mem) => (snapsOf.get(m.id) ?? []).map((r) => {
    const bits = [(r.mediums ?? []).map((x) => MED[x] ?? x).join(" + "), r.response ? RESP[r.response] ?? r.response : "", r.comment ?? ""].filter(Boolean);
    return `R${r.round}: ${bits.join(" · ") || "—"}`;
  }).join(" | ");

  // ── Per-round coupon redemption (same basis as the tracker) ──
  // A round with a coupon code is scored on hard redemptions; matching rides on item OR invoice coupon,
  // over the round window + 30-day tail. byFarmer covers ALL enrolled farmers (for the data-dump sheets);
  // the overview headline uses the reached-TEST subset to mirror the tracker.
  const memberFarmerIds = [...new Set(members.map((m) => m.farmerId))];
  const reachedTestFarmerIds = new Set(test.filter(everReached).map((m) => m.farmerId));
  const roundCoupon = new Map<number, { codes: string[]; byFarmer: Map<number, number> }>();
  for (const p of phases) {
    const codes = [...new Set(asCoupons(p.coupons).map((c) => c.code.trim().toUpperCase()).filter(Boolean))];
    if (!codes.length) { roundCoupon.set(p.ordinal, { codes: [], byFarmer: new Map() }); continue; }
    const rEnd = new Date(p.defaultEnd); rEnd.setDate(rEnd.getDate() + 30);
    roundCoupon.set(p.ordinal, { codes, byFarmer: await couponSpendByFarmer(codes, memberFarmerIds, p.defaultStart, rEnd) });
  }
  const anyCoupons = [...roundCoupon.values()].some((r) => r.codes.length > 0);
  // Per-farmer rollup across all rounds → codes redeemed + total coupon revenue (All-farmers sheet).
  const couponByFarmer = new Map<number, { codes: Set<string>; revenue: number }>();
  for (const rc of roundCoupon.values()) {
    for (const [fid, rev] of rc.byFarmer) {
      if (rev <= 0) continue;
      const e = couponByFarmer.get(fid) ?? { codes: new Set<string>(), revenue: 0 };
      rc.codes.forEach((c) => e.codes.add(c)); e.revenue += rev;
      couponByFarmer.set(fid, e);
    }
  }

  // ── Overview sheet ──
  const overview: (string | number)[][] = [
    ["Campaign", campaignName],
    ["Location filter", locSummary(loc)],
    ["Enrolled (total)", members.length],
    ["  Test", test.length],
    ["  Control", members.length - test.length],
    ["Reached (test, any round)", count(everReached)],
    [""],
    ["Reach by channel (test group)", ""],
    ...(["CALL", "WHATSAPP", "SMS", "IN_PERSON", "UNREACHABLE"] as const).map((c) => [MED[c], count((m) => (m.mediums ?? []).includes(c))] as (string | number)[]),
    [""],
    ["Interest response (test group)", ""],
    ...(["INTERESTED", "NOT_INTERESTED", "OTHER_CROP"] as const).map((r) => [RESP[r], count((m) => m.response === r)] as (string | number)[]),
    [""],
    ["Broadcast delivered (test group)", count((m) => (m.broadcastMediums ?? []).length > 0)],
    ["  via SMS", count((m) => (m.broadcastMediums ?? []).includes("SMS"))],
    ["  via WhatsApp", count((m) => (m.broadcastMediums ?? []).includes("WHATSAPP"))],
    [""],
    ["Rounds", ""],
    ["Round", "Window", "SMS sent", "WhatsApp sent", "Farmers reached in round", "Basis", "Coupon code(s)", "Redeemers (reached test)", "Redemption rate", "Coupon revenue (₹)"],
    ...phases.map((p) => {
      const sms = [...smsByRound].filter(([k]) => k.endsWith(`:${p.ordinal}`)).reduce((s, [, v]) => s + v, 0);
      const wa = [...waByRound].filter(([k]) => k.endsWith(`:${p.ordinal}`)).reduce((s, [, v]) => s + v, 0);
      const reached = test.filter((m) => recIn(m, p.ordinal)?.reached).length;
      const rc = roundCoupon.get(p.ordinal)!;
      const reachedCount = reachedTestFarmerIds.size;
      let redeemers = 0, rev = 0;
      if (rc.codes.length) for (const fid of reachedTestFarmerIds) { const v = rc.byFarmer.get(fid) ?? 0; if (v > 0) { redeemers++; rev += v; } }
      const couponCols: (string | number)[] = rc.codes.length
        ? ["Coupon", rc.codes.join(", "), redeemers, reachedCount ? `${Math.round((redeemers / reachedCount) * 1000) / 10}%` : "—", Math.round(rev)]
        : ["Spend", "", "", "", ""];
      return [`${p.ordinal}. ${p.name}`, `${fmtDay(p.defaultStart)} → ${fmtDay(p.defaultEnd)}`, sms, wa, reached, ...couponCols] as (string | number)[];
    }),
    [""],
    ["Note", "Each round's outcome (channels, response, comment) is saved when the campaign moves to the next round, so the per-round sheets show what happened in that round. SMS/WhatsApp sends are counted by the round window they fall in. 'All farmers' shows the current round plus a summary of earlier rounds."],
    ["Coupon note", "A round with a coupon code is scored on hard redemptions (a reached test farmer buying on that code, item or invoice, within the round window + 30 days). A round with no code falls back to matched spend, same as the campaign total."],
  ];

  // ── All farmers sheet (full current outreach state) ──
  const allHeader = ["Group", "Farmer", "Mobile", "Village", "District", "Region", "Store code", "Store", "RM", "Value segment", "Lifecycle", "Reached", "Channels", "Response", "Response crop", "Broadcast delivered", "SMS sent", "WhatsApp sent",
    ...(anyCoupons ? ["Coupon(s) redeemed", "Coupon revenue (₹)"] : []),
    "Recorded by", "Recorded at (IST)", "Comment", "Earlier rounds"];
  const allRows: (string | number)[][] = members.map((m) => {
    const f = fMap.get(m.farmerId);
    const cp = couponByFarmer.get(m.farmerId);
    return [
      m.group ?? "", f?.name ?? `Farmer #${m.farmerId}`, f?.mobile ?? "", ...locCols(m), storeCode(m.storeId), store(m.storeId), rm(m.storeId),
      m.valueSegment ? segMeta(m.valueSegment).label : (m.segment ? segMeta(m.segment).label : ""),
      m.lifecycleSegment ? segMeta(m.lifecycleSegment).label : "",
      m.reached ? "Yes" : "No",
      (m.mediums ?? []).map((x) => MED[x] ?? x).join(", "),
      m.response ? RESP[m.response] ?? m.response : "", m.responseCrop ? cropLabel(m.responseCrop) : "",
      (m.broadcastMediums ?? []).map((x) => MED[x] ?? x).join(", "),
      smsTotal.get(m.id) ?? 0, waTotal.get(m.id) ?? 0,
      ...(anyCoupons ? [cp ? [...cp.codes].join(", ") : "", cp ? Math.round(cp.revenue) : ""] : []),
      m.reachedBy ? `${m.reachedBy}${m.reachedByCode ? ` (${m.reachedByCode})` : ""}` : "", fmtTs(m.reachedAt), m.comment ?? "",
      earlierText(m),
    ];
  });

  const sheets: { name: string; rows: Cell[][] }[] = [
    { name: "Overview", rows: overview },
    { name: "All farmers", rows: [allHeader, ...allRows] },
  ];

  // ── One sheet per round — message sends in that round's window + who was reached in it ──
  const roundHeader = ["Farmer", "Mobile", "Village", "District", "Region", "Store", "RM", "SMS sent (round)", "WhatsApp sent (round)", "Reached in round", "Response", "Comment", "Recorded by", "Recorded at (IST)"];
  const roundHeaderCoupon = ["Farmer", "Mobile", "Village", "District", "Region", "Store", "RM", "Group", "SMS sent (round)", "WhatsApp sent (round)", "Reached in round", "Redeemed coupon", "Coupon revenue (₹)", "Response", "Comment", "Recorded by", "Recorded at (IST)"];
  for (const p of phases) {
    const rc = roundCoupon.get(p.ordinal)!;
    const isCoupon = rc.codes.length > 0;
    const rrows: (string | number)[][] = [];
    for (const m of members) {
      const sms = smsByRound.get(`${m.id}:${p.ordinal}`) ?? 0;
      const wa = waByRound.get(`${m.id}:${p.ordinal}`) ?? 0;
      const rec = recIn(m, p.ordinal);
      const reachedIn = !!rec;
      const redeemed = rc.byFarmer.get(m.farmerId) ?? 0;
      // Coupon rounds also list farmers who redeemed even with no logged send/reach (e.g. via broadcast).
      if (!sms && !wa && !reachedIn && !(isCoupon && redeemed > 0)) continue;
      const f = fMap.get(m.farmerId);
      const base: (string | number)[] = [f?.name ?? `Farmer #${m.farmerId}`, f?.mobile ?? "", ...locCols(m), store(m.storeId), rm(m.storeId)];
      const tail: (string | number)[] = rec
        ? [rec.response ? RESP[rec.response] ?? rec.response : "", rec.comment ?? "", rec.reachedBy ? `${rec.reachedBy}${rec.reachedByCode ? ` (${rec.reachedByCode})` : ""}` : "", fmtTs(rec.reachedAt)]
        : ["", "", "", ""];
      rrows.push(isCoupon
        ? [...base, m.group ?? "", sms, wa, rec ? (rec.reached ? "Yes" : "No") : "", redeemed > 0 ? "Yes" : "", redeemed > 0 ? Math.round(redeemed) : "", ...tail]
        : [...base, sms, wa, rec ? (rec.reached ? "Yes" : "No") : "", ...tail]);
    }
    const nm = `R${p.ordinal} ${p.name}`.replace(/[\\/?*[\]:]/g, " ").slice(0, 31); // Excel sheet-name limit
    const noActivity = isCoupon ? "No sends, reaches or coupon redemptions in this round's window." : "No message sends or reaches recorded in this round's window.";
    sheets.push({ name: nm || `Round ${p.ordinal}`, rows: rrows.length ? [isCoupon ? roundHeaderCoupon : roundHeader, ...rrows] : [[noActivity]] });
  }

  // ── Transactions sheet — every line item campaign farmers (TEST + CONTROL) bought in the window ──
  // The Group column lets you compare what the contacted test group bought vs the un-contacted control.
  if (camp) {
    const winStart = camp.startDate;
    const winEnd = new Date(camp.endDate); winEnd.setDate(winEnd.getDate() + 30);
    const memberIds = [...new Set(members.map((m) => m.farmerId))];
    const memMeta = new Map(members.map((m) => [m.farmerId, {
      group: m.group ?? "",
      loc: locCols(m),
      vseg: m.valueSegment ? segMeta(m.valueSegment).label : (m.segment ? segMeta(m.segment).label : ""),
      lseg: m.lifecycleSegment ? segMeta(m.lifecycleSegment).label : "",
      reached: everReached(m) ? "Yes" : "No",
    }]));
    const txns = memberIds.length
      ? await prisma.saleLine.findMany({
          where: { source: "REAL", farmerId: { in: memberIds }, soldAt: { gte: winStart, lte: winEnd } },
          select: { farmerId: true, soldAt: true, orderNo: true, itemRaw: true, cropTag: true, qty: true, uom: true, basic: true, itemCouponCode: true, invoiceCouponCode: true, storeId: true },
          orderBy: [{ farmerId: "asc" }, { soldAt: "asc" }],
          take: 100000,
        })
      : [];
    // Test rows first, then control (Excel autofilter still lets them slice either way).
    txns.sort((a, b) => (memMeta.get(a.farmerId!)?.group === memMeta.get(b.farmerId!)?.group ? 0 : memMeta.get(a.farmerId!)?.group === "TEST" ? -1 : 1));
    const txnHeader = ["Group", "Reached", "Farmer", "Mobile", "Village", "District", "Region", "Store code", "Store", "RM", "Value segment", "Lifecycle", "Date", "Order No", "Item", "Crop", "Qty", "UOM", "Base value (₹)", "Coupon"];
    const txnRows: (string | number)[][] = txns.map((r) => {
      const f = r.farmerId != null ? fMap.get(r.farmerId) : undefined;
      const meta = r.farmerId != null ? memMeta.get(r.farmerId) : undefined;
      const coupon = (r.itemCouponCode && r.itemCouponCode !== "0" ? r.itemCouponCode : "") || (r.invoiceCouponCode && r.invoiceCouponCode !== "0" ? r.invoiceCouponCode : "");
      return [
        meta?.group ?? "", meta?.reached ?? "", f?.name ?? (r.farmerId != null ? `Farmer #${r.farmerId}` : "—"), f?.mobile ?? "", ...(meta?.loc ?? ["", "", ""]), storeCode(r.storeId), store(r.storeId), rm(r.storeId), meta?.vseg ?? "", meta?.lseg ?? "",
        r.soldAt ? fmtDay(r.soldAt) : "", r.orderNo ?? "", r.itemRaw ?? "", r.cropTag ? cropLabel(r.cropTag) : "",
        r.qty ?? 0, r.uom ?? "", Math.round(r.basic ?? 0), coupon,
      ];
    });
    sheets.push({ name: "Transactions", rows: txnRows.length ? [txnHeader, ...txnRows] : [["No transactions by campaign farmers in the window."]] });
  }

  // ── Performance (formulas) sheet — Shilpa's uplift table with LIVE Excel formula linking ──
  // Raw inputs (Test/Reach/Buy/Control/Ctrl Buy/Total sales) are values; every derived column
  // (%buy, uplift %, incremental) is a real formula so the workbook recalculates when opened.
  const tracker = await getCampaignTracker(campaignId, loc ?? undefined);
  if (tracker) {
    const VIEW_LBL: Record<MatchView, string> = { coupon: "Coupon-redeemed", crop: "Crop-matched", total: "All transactions" };
    const COLHDR = ["Segment", "Test", "Reach", "Buy", "Test %Buy", "Reach %Buy", "Control", "Ctrl Buy", "Ctrl %Buy", "Uplift %", "Incr (all test)", "Incr (reached)", "Total sales (all test)", "Total sales (reached)"];
    const perf: Cell[][] = [
      [`Location: ${locSummary(loc)}`],
      ["Campaign performance — live formulas. Uplift % = (Reach %Buy − Ctrl %Buy) ÷ Reach %Buy · Incremental = Uplift % × total sales (all transactions). Leads/No-spend: no control → full sales are incremental."],
      [],
    ];
    for (const sc of tracker.scopes) {
      for (const view of MV) {
        perf.push([`${sc.label}  ·  ${VIEW_LBL[view]}  ·  ${sc.windowStart} → ${sc.windowEnd}`]);
        perf.push(COLHDR);
        const isCoupon = view === "coupon";
        for (const r of sc.byValue) {
          const c = r.views[view];
          const nrow = perf.length + 1; // Excel row of the row we are about to push
          // Coupon view: uplift is n/a and Incremental = coupon revenue redeemed (a value, not a formula).
          const uplift: Cell = isCoupon || r.isLeads ? "—" : { f: `IF(F${nrow}=0,"",(F${nrow}-I${nrow})/F${nrow})`, z: "0.0%" };
          const incrAll: Cell = isCoupon ? c.incrAllTest : r.isLeads ? { f: `M${nrow}` } : { f: `IF(J${nrow}="",0,J${nrow}*M${nrow})` };
          const incrReach: Cell = isCoupon ? c.incrReached : r.isLeads ? { f: `N${nrow}` } : { f: `IF(J${nrow}="",0,J${nrow}*N${nrow})` };
          perf.push([
            segMeta(r.segment).label, r.test, r.reached, c.buy,
            { f: `IF(B${nrow}=0,0,D${nrow}/B${nrow})`, z: "0.0%" },
            { f: `IF(C${nrow}=0,0,D${nrow}/C${nrow})`, z: "0.0%" },
            r.control, c.controlBuy,
            { f: `IF(G${nrow}=0,0,H${nrow}/G${nrow})`, z: "0.0%" },
            uplift, incrAll, incrReach,
            r.totalSalesAllTest, r.totalSalesReached,
          ]);
        }
        perf.push([]);
      }
    }
    sheets.push({ name: "Performance (formulas)", rows: perf });
  }

  const safe = (campaignName || "campaign").replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 60) || "campaign";
  const b64 = buildWorkbookB64(sheets);
  return { ok: true, filename: `${safe} - outreach log.xlsx`, b64 };
}

/* ── Campaign audience analytics: composition breakdowns + Segment × Store matrix ── */
export interface SegCol { key: string; label: string; color: string; bg: string }
/** One outreach row: `store` is the row label (centre / region / district / village); `sub` = its parent (store's region, village's district). */
export interface CallRow { store: string; sub: string; test: number; reached: number; call: number; whatsapp: number; sms: number; inPerson: number; pending: number }
export interface CampaignAnalytics {
  total: number;
  byValue: (SegCol & { count: number })[];       // value-tier composition (HNI/Potential/Regular)
  byLifecycle: (SegCol & { count: number })[];    // lifecycle composition (New/At Risk/Lapsed)
  byStore: { label: string; count: number }[];
  byRegion: { label: string; count: number }[];
  byDistrict: { label: string; count: number }[];
  byVillage: { label: string; count: number }[];
  byCrop: { label: string; count: number }[];
  valueCols: SegCol[];      // matrix value columns
  lifecycleCols: SegCol[];  // matrix lifecycle columns
  /** Merged Store × (Value | Lifecycle) matrix — both count-sets sum to `total` per store. */
  matrix: { store: string; region: string; value: Record<string, number>; lifecycle: Record<string, number>; total: number }[];
  /** Per-centre (store) outreach breakdown over the TEST group: reached + how (Call/WA/SMS/In-person).
   *  Scoped like everything else, so an RM sees only their own centres. A farmer reached by more than
   *  one approach counts under each, so the approach columns can exceed `reached`. */
  callByStore: CallRow[];
  /** The same outreach breakdown by farmer location (TEST group). Village rows are capped at the top 300. */
  callByLocation: { region: CallRow[]; district: CallRow[]; village: CallRow[] };
  /** Distinct Region/District/Village combinations of the campaign's farmers (scope applied, filters NOT) — filter options. */
  locItems: LocItem[];
  /** Regional managers that have members in this campaign (within the caller's scope) — for the RM filter. */
  rmOptions: string[];
}

const EMPTY_ANALYTICS: CampaignAnalytics = { total: 0, byValue: [], byLifecycle: [], byStore: [], byRegion: [], byDistrict: [], byVillage: [], byCrop: [], valueCols: [], lifecycleCols: [], matrix: [], callByStore: [], callByLocation: { region: [], district: [], village: [] }, locItems: [], rmOptions: [] };
const colOf = (k: string): SegCol => { const m = segMeta(k); return { key: k, label: m.label, color: m.color, bg: m.bg }; };

/**
 * Composition of a campaign's enrolled farmers — for the "Analytics" button on each campaign row.
 * Scoped like the other member views (officer→store, RM→zone, central→all). Counts every enrolled
 * member (TEST + CONTROL). Returns single-dimension breakdowns + a Segment × Store cross-tab.
 */
export async function getCampaignAnalytics(campaignId: number, rms?: string[], locIn?: LocFilter): Promise<CampaignAnalytics> {
  const loc = sanitizeLoc(locIn);
  const scope = await memberScopeWhere();
  if (scope === "none") return EMPTY_ANALYTICS;
  const allMembers = await prisma.campaignMember.findMany({
    where: { campaignId, ...(scope ?? {}) },
    select: { farmerId: true, segment: true, valueSegment: true, lifecycleSegment: true, storeId: true, group: true, reached: true, mediums: true },
    take: 40000, // realistic campaigns are far below this; guards a pathological audience
  });
  if (!allMembers.length) return EMPTY_ANALYTICS;

  const farmerIds = [...new Set(allMembers.map((m) => m.farmerId))];
  const [farmers, stores] = await Promise.all([
    prisma.farmer.findMany({ where: { id: { in: farmerIds } }, select: { id: true, village: true, district: true, cropTags: true } }),
    prisma.store.findMany({ select: { id: true, name: true, regionalManager: true, zone: true } }),
  ]);
  const fMap = new Map(farmers.map((f) => [f.id, f]));
  const sMap = new Map(stores.map((s) => [s.id, shortStoreName(s.name)]));
  const rmByStore = new Map(stores.map((s) => [s.id, (s.regionalManager ?? "").trim()]));
  const zoneByStore = new Map(stores.map((s) => [s.id, locVal(s.zone)]));
  const zoneByName = new Map(stores.map((s) => [shortStoreName(s.name), locVal(s.zone) ?? ""]));
  const locOf = (m: { farmerId: number; storeId: number | null }) => {
    const f = fMap.get(m.farmerId);
    return { village: locVal(f?.village), district: locVal(f?.district), region: m.storeId != null ? zoneByStore.get(m.storeId) ?? null : null };
  };
  const locItems = locItemsOf(allMembers.map(locOf)); // filter options: every location in scope, before RM/location filters

  // RM options = every RM with members in this campaign (within scope), computed BEFORE the RM filter.
  const rmOptions = [...new Set(allMembers.map((m) => (m.storeId != null ? rmByStore.get(m.storeId) : "") || "").filter(Boolean))].sort((a, b) => a.localeCompare(b));
  // Apply the optional RM filter in-memory (keeps it to one members query).
  const rmSet = rms?.length ? new Set(rms) : null;
  const inLoc = locMatcher(loc);
  const members = allMembers.filter((m) =>
    (!rmSet || (m.storeId != null && rmSet.has(rmByStore.get(m.storeId) ?? ""))) && (!loc || inLoc(locOf(m))));
  if (!members.length) return { ...EMPTY_ANALYTICS, rmOptions, locItems };

  const vcount: Record<string, number> = {}, lcount: Record<string, number> = {};
  const store: Record<string, number> = {};
  const village: Record<string, number> = {};
  const region: Record<string, number> = {}, district: Record<string, number> = {};
  const crop: Record<string, number> = {};
  // Store → { value → count, lifecycle → count } cross-tab (both sum to the store's member count).
  const cross = new Map<string, { value: Record<string, number>; lifecycle: Record<string, number>; total: number }>();
  // Centre-wise outreach (TEST group only): per store → reached + approach counts.
  type CallAcc = { sub: string; test: number; reached: number; call: number; whatsapp: number; sms: number; inPerson: number };
  const callMap = new Map<string, CallAcc>();
  // Same outreach tallies keyed by location. Village keys carry the district (same name can sit in two districts).
  const callLoc = { region: new Map<string, CallAcc>(), district: new Map<string, CallAcc>(), village: new Map<string, CallAcc>() };
  const tally = (map: Map<string, CallAcc>, key: string, sub: string, m: (typeof members)[number]) => {
    const cs = map.get(key) ?? map.set(key, { sub, test: 0, reached: 0, call: 0, whatsapp: 0, sms: 0, inPerson: 0 }).get(key)!;
    cs.test += 1;
    if (m.reached) cs.reached += 1;
    const meds = m.mediums ?? [];
    if (meds.includes("CALL")) cs.call += 1;
    if (meds.includes("WHATSAPP")) cs.whatsapp += 1;
    if (meds.includes("SMS")) cs.sms += 1;
    if (meds.includes("IN_PERSON")) cs.inPerson += 1;
  };
  for (const m of members) {
    const f = fMap.get(m.farmerId);
    const storeName = m.storeId != null ? sMap.get(m.storeId) ?? "—" : "—";
    const loc_ = locOf(m);
    if (m.group === "TEST") {
      tally(callMap, storeName, zoneByName.get(storeName) ?? "", m);
      tally(callLoc.region, locLabel(loc_.region), "", m);
      tally(callLoc.district, locLabel(loc_.district), "", m);
      tally(callLoc.village, `${locLabel(loc_.village)}\u0001${loc_.district ?? ""}`, loc_.district ?? "", m);
    }
    region[locLabel(loc_.region)] = (region[locLabel(loc_.region)] ?? 0) + 1;
    district[locLabel(loc_.district)] = (district[locLabel(loc_.district)] ?? 0) + 1;
    // Fall back to deriving from the legacy collapsed snapshot for pre-split members.
    const v = m.valueSegment ?? (VALUE_SEGMENTS.includes(m.segment as never) ? m.segment : "REGULAR");
    const l = m.lifecycleSegment ?? (LIFECYCLE_SEGMENTS.includes(m.segment as never) ? m.segment : "LAPSED");
    const villageName = loc_.village || "—";
    vcount[v] = (vcount[v] ?? 0) + 1;
    lcount[l] = (lcount[l] ?? 0) + 1;
    store[storeName] = (store[storeName] ?? 0) + 1;
    if (villageName !== "—") village[villageName] = (village[villageName] ?? 0) + 1;
    for (const c of (f?.cropTags ?? [])) crop[c] = (crop[c] ?? 0) + 1;
    const row = cross.get(storeName) ?? cross.set(storeName, { value: {}, lifecycle: {}, total: 0 }).get(storeName)!;
    row.value[v] = (row.value[v] ?? 0) + 1;
    row.lifecycle[l] = (row.lifecycle[l] ?? 0) + 1;
    row.total += 1;
  }
  const top = (o: Record<string, number>, k = 12) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, k).map(([label, count]) => ({ label, count }));
  const matrix = [...cross.entries()].map(([storeName, c]) => ({ store: storeName, region: zoneByName.get(storeName) ?? "", value: c.value, lifecycle: c.lifecycle, total: c.total })).sort((a, b) => b.total - a.total);
  const callRows = (map: Map<string, CallAcc>, cap = Infinity): CallRow[] => [...map.entries()]
    .map(([key, c]) => ({ store: key.split("\u0001")[0], ...c, pending: Math.max(0, c.test - c.reached) }))
    .sort((a, b) => b.test - a.test || a.store.localeCompare(b.store))
    .slice(0, cap);
  return {
    total: members.length,
    byValue: VALUE_SEGMENTS.filter((k) => vcount[k]).map((k) => ({ ...colOf(k), count: vcount[k] })),
    byLifecycle: LIFECYCLE_SEGMENTS.filter((k) => lcount[k]).map((k) => ({ ...colOf(k), count: lcount[k] })),
    byStore: top(store),
    byRegion: top(region),
    byDistrict: top(district),
    byVillage: top(village),
    byCrop: top(crop).map((x) => ({ label: cropLabel(x.label), count: x.count })),
    valueCols: [...VALUE_SEGMENTS].map(colOf),
    lifecycleCols: [...LIFECYCLE_SEGMENTS].map(colOf),
    matrix,
    callByStore: callRows(callMap),
    callByLocation: { region: callRows(callLoc.region), district: callRows(callLoc.district), village: callRows(callLoc.village, 300) },
    locItems,
    rmOptions,
  };
}

/* ── Round-by-round analytics (Analytics modal "🔁 Rounds" tab + export sheets) ──
 * A round's outcome per TEST member: finished rounds read the CampaignMemberRound snapshot (no row = nothing
 * recorded), the current round reads the live CampaignMember outcome, upcoming rounds have none yet.
 * "Bought" = purchased the campaign's products (cluster crop/category, or anything when the cluster isn't
 * product-specific) inside the round's own window (start → end day, inclusive). Control holdouts give a
 * per-round baseline. Same scope + RM + location filters as the rest of the modal. */
export type RoundCat = "INTERESTED" | "NOT_INTERESTED" | "OTHER_CROP" | "REACHED" | "UNREACHABLE" | "NONE";
const ROUND_CATS: RoundCat[] = ["INTERESTED", "NOT_INTERESTED", "OTHER_CROP", "REACHED", "UNREACHABLE", "NONE"];
export interface RoundMeta {
  ordinal: number; name: string; start: string; end: string; // YYYY-MM-DD (end inclusive)
  status: "done" | "current" | "upcoming";
  coupons: string[];
  days: number;            // length of the round in days
  dayNow: number | null;   // current round: today's day number (1-based, capped at `days`)
}
export interface RoundStat {
  ordinal: number;
  test: number; control: number;
  recorded: number; reached: number; unreachable: number;
  call: number; whatsapp: number; sms: number; inPerson: number;
  interested: number; notInterested: number; otherCrop: number; noResponse: number;
  buyersReached: number; buyersNotReached: number; buyersControl: number; // campaign-product buyers in the round window
  salesReached: number; salesTest: number;                                 // campaign-product base ₹ in the window
  interestedBought: number;
  couponRedeemers: number | null; couponRevenue: number | null;           // null = the round has no coupon codes
}
export interface RoundGeoCell { reached: number; interested: number; bought: number; recorded: number }
export interface RoundGeoRow { label: string; sub: string; test: number; r: Record<number, RoundGeoCell> }
export interface RoundTransition { from: number; to: number; cells: Record<RoundCat, Record<RoundCat, number>>; boughtTo: Record<RoundCat, number> }
export interface RoundAnalytics {
  rounds: RoundMeta[]; currentRound: number; hasPhases: boolean; basisLabel: string;
  stats: RoundStat[];
  transitions: RoundTransition[];
  geo: { store: RoundGeoRow[]; region: RoundGeoRow[]; district: RoundGeoRow[]; village: RoundGeoRow[] };
  /** Call-stats rows (same shape as the Overview tables) per round key ("1", "2", … and "all" = reached in any round). */
  callBy: Record<string, { store: CallRow[]; region: CallRow[]; district: CallRow[]; village: CallRow[] }>;
  pace: Record<number, number[]>;  // reached outcomes recorded per day of the round (index 0 = day 1)
  callers: { name: string; r: Record<number, { recorded: number; reached: number; interested: number }> }[];
  otherCrops: Record<number, { crop: string; count: number }[]>;
}

type RoundOutcome = { reached: boolean; mediums: string[]; response: string | null; responseCrop: string | null; comment: string | null; reachedAt: Date | null; reachedBy: string | null; reachedByCode: string | null };
const DAY_MS = 86_400_000;
const istDayNum = (d: Date) => Math.floor((d.getTime() + 330 * 60_000) / DAY_MS);
const catOf = (o: RoundOutcome | undefined): RoundCat => {
  if (!o) return "NONE";
  if (o.response === "INTERESTED" || o.response === "NOT_INTERESTED" || o.response === "OTHER_CROP") return o.response;
  if (o.reached) return "REACHED";
  if (o.mediums.includes("UNREACHABLE")) return "UNREACHABLE";
  return "NONE";
};

/** Shared loader for the round analytics screen and the round sheets of the analytics export. */
async function loadRoundData(campaignId: number, rms?: string[], locIn?: LocFilter) {
  const loc = sanitizeLoc(locIn);
  const scope = await memberScopeWhere();
  if (scope === "none") return null;
  const camp = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!camp) return null;
  const allMembers = await prisma.campaignMember.findMany({
    where: { campaignId, ...(scope ?? {}) },
    select: { id: true, farmerId: true, group: true, storeId: true, segment: true, valueSegment: true, lifecycleSegment: true, reached: true, mediums: true, response: true, responseCrop: true, comment: true, reachedAt: true, reachedBy: true, reachedByCode: true },
    take: 40000,
  });
  if (!allMembers.length) return null;
  const [farmers, stores, phases, snaps, clusterIds] = await Promise.all([
    prisma.farmer.findMany({ where: { id: { in: [...new Set(allMembers.map((m) => m.farmerId))] } }, select: { id: true, name: true, mobile: true, village: true, district: true } }),
    prisma.store.findMany({ select: { id: true, code: true, name: true, regionalManager: true, zone: true } }),
    prisma.campaignPhase.findMany({ where: { campaignId }, orderBy: { ordinal: "asc" }, select: { ordinal: true, name: true, defaultStart: true, defaultEnd: true, coupons: true } }),
    prisma.campaignMemberRound.findMany({ where: { campaignId } }),
    resolveCampaignClusters([camp]).then((m) => m.get(camp) ?? []),
  ]);
  const clusterRows = clusterIds.length ? await prisma.cluster.findMany({ where: { id: { in: clusterIds } }, select: { criteria: true } }) : [];
  const pf = productFilterOf(clusterRows.map((c) => parseCriteria(c.criteria)).filter((x): x is ClusterCriteria => !!x));

  const fMap = new Map(farmers.map((f) => [f.id, f]));
  const sName = new Map(stores.map((s) => [s.id, shortStoreName(s.name) || s.name]));
  const sCode = new Map(stores.map((s) => [s.id, s.code]));
  const sRm = new Map(stores.map((s) => [s.id, (s.regionalManager ?? "").trim()]));
  const sZone = new Map(stores.map((s) => [s.id, locVal(s.zone)]));
  const locOf = (m: { farmerId: number; storeId: number | null }) => {
    const f = fMap.get(m.farmerId);
    return { village: locVal(f?.village), district: locVal(f?.district), region: m.storeId != null ? sZone.get(m.storeId) ?? null : null };
  };
  const rmSet = rms?.length ? new Set(rms) : null;
  const inLoc = locMatcher(loc);
  const members = allMembers.filter((m) => (!rmSet || (m.storeId != null && rmSet.has(sRm.get(m.storeId) ?? ""))) && (!loc || inLoc(locOf(m))));
  if (!members.length) return null;

  // Rounds: the campaign's phases (any gap / a current round beyond the last phase gets a placeholder);
  // a campaign without phases is one round spanning the campaign dates.
  const cur = Math.max(1, camp.currentRound);
  const phaseBy = new Map(phases.map((p) => [p.ordinal, p]));
  const maxOrd = Math.max(cur, ...phases.map((p) => p.ordinal), 1);
  const today = istDayNum(new Date());
  const rounds: (RoundMeta & { startAt: Date; endAt: Date; codes: string[] })[] = [];
  for (let o = 1; o <= maxOrd; o++) {
    const p = phaseBy.get(o);
    const s = p?.defaultStart ?? camp.startDate, e = p?.defaultEnd ?? camp.endDate;
    const days = Math.max(1, istDayNum(e) - istDayNum(s) + 1);
    const status: RoundMeta["status"] = o < cur ? "done" : o === cur ? "current" : "upcoming";
    const codes = p ? [...new Set(asCoupons(p.coupons).map((c) => c.code.trim().toUpperCase()).filter(Boolean))] : [];
    rounds.push({
      ordinal: o, name: p?.name ?? (phases.length ? `Round ${o}` : "Round 1"), start: iso(s)!, end: iso(e)!, status, coupons: codes, days,
      dayNow: status === "current" ? Math.min(days, Math.max(1, today - istDayNum(s) + 1)) : null,
      startAt: s, endAt: new Date(e.getTime() + DAY_MS - 1), codes,
    });
  }
  const started = rounds.filter((r) => r.status !== "upcoming");

  // Outcome per (member, round).
  const snapBy = new Map(snaps.map((r) => [`${r.memberId}:${r.round}`, r]));
  const outcome = (m: (typeof members)[number], ord: number): RoundOutcome | undefined => {
    if (ord === cur) return (m.reachedAt || m.comment || m.response || m.mediums.length) ? m : undefined;
    if (ord > cur) return undefined;
    return snapBy.get(`${m.id}:${ord}`);
  };

  // Campaign-product purchases per round window (test + control), and coupon redemptions (test).
  const test = members.filter((m) => m.group === "TEST");
  const control = members.filter((m) => m.group !== "TEST");
  const allIds = [...new Set(members.map((m) => m.farmerId))];
  const testIds = [...new Set(test.map((m) => m.farmerId))];
  const spend = new Map<number, Map<number, number>>(), coupon = new Map<number, Map<number, number>>();
  for (const r of started) {
    spend.set(r.ordinal, await matchedSpendByFarmer(pf, allIds, r.startAt, r.endAt));
    if (r.codes.length) coupon.set(r.ordinal, await couponSpendByFarmer(r.codes, testIds, r.startAt, r.endAt));
  }
  const basisLabel = pf.all
    ? "any purchase (the campaign's clusters aren't product-specific)"
    : [pf.crops.length ? `crop: ${pf.crops.map(cropLabel).join(", ")}` : "", pf.categories.length ? `category: ${pf.categories.join(", ")}` : ""].filter(Boolean).join(" · ");

  return { camp, cur, rounds, started, members, test, control, outcome, spend, coupon, fMap, sName, sCode, sRm, locOf, basisLabel, hasPhases: phases.length > 0, loc };
}

/** Round-by-round outreach, response, purchase, flow and centre comparisons for the Analytics modal. */
export async function getCampaignRoundAnalytics(campaignId: number, rms?: string[], locIn?: LocFilter): Promise<RoundAnalytics | null> {
  const d = await loadRoundData(campaignId, rms, locIn);
  return d ? computeRoundAnalytics(d) : null;
}

function computeRoundAnalytics(d: NonNullable<Awaited<ReturnType<typeof loadRoundData>>>): RoundAnalytics {
  const { rounds, started, test, control, outcome, spend, coupon, sName, locOf } = d;

  const stats: RoundStat[] = [];
  const pace: Record<number, number[]> = {};
  const otherCrops: Record<number, { crop: string; count: number }[]> = {};
  const callerMap = new Map<string, { name: string; r: Record<number, { recorded: number; reached: number; interested: number }> }>();
  for (const r of rounds) {
    const st: RoundStat = {
      ordinal: r.ordinal, test: test.length, control: control.length, recorded: 0, reached: 0, unreachable: 0, call: 0, whatsapp: 0, sms: 0, inPerson: 0,
      interested: 0, notInterested: 0, otherCrop: 0, noResponse: 0, buyersReached: 0, buyersNotReached: 0, buyersControl: 0, salesReached: 0, salesTest: 0,
      interestedBought: 0, couponRedeemers: r.codes.length ? 0 : null, couponRevenue: r.codes.length ? 0 : null,
    };
    const days = new Array<number>(r.days).fill(0);
    const crops = new Map<string, number>();
    const sp = spend.get(r.ordinal), cp = coupon.get(r.ordinal);
    if (r.status !== "upcoming") {
      for (const m of test) {
        const o = outcome(m, r.ordinal);
        const bought = sp?.get(m.farmerId) ?? 0;
        st.salesTest += bought;
        if (o) {
          st.recorded++;
          const by = o.reachedBy ? `${o.reachedBy}${o.reachedByCode ? ` (${o.reachedByCode})` : ""}` : null;
          if (by) {
            const c = callerMap.get(by) ?? callerMap.set(by, { name: by, r: {} }).get(by)!;
            const cc = c.r[r.ordinal] ?? (c.r[r.ordinal] = { recorded: 0, reached: 0, interested: 0 });
            cc.recorded++; if (o.reached) cc.reached++; if (o.response === "INTERESTED") cc.interested++;
          }
        }
        if (o?.reached) {
          st.reached++;
          if (o.mediums.includes("CALL")) st.call++;
          if (o.mediums.includes("WHATSAPP")) st.whatsapp++;
          if (o.mediums.includes("SMS")) st.sms++;
          if (o.mediums.includes("IN_PERSON")) st.inPerson++;
          if (o.response === "INTERESTED") { st.interested++; if (bought > 0) st.interestedBought++; }
          else if (o.response === "NOT_INTERESTED") st.notInterested++;
          else if (o.response === "OTHER_CROP") { st.otherCrop++; if (o.responseCrop) crops.set(o.responseCrop, (crops.get(o.responseCrop) ?? 0) + 1); }
          else st.noResponse++;
          if (bought > 0) { st.buyersReached++; st.salesReached += bought; }
          if (o.reachedAt) days[Math.min(r.days - 1, Math.max(0, istDayNum(o.reachedAt) - istDayNum(r.startAt)))]++;
        } else {
          if (o && o.mediums.includes("UNREACHABLE")) st.unreachable++;
          if (bought > 0) st.buyersNotReached++;
        }
        if (cp && (cp.get(m.farmerId) ?? 0) > 0) { st.couponRedeemers!++; st.couponRevenue! += cp.get(m.farmerId)!; }
      }
      for (const m of control) if ((sp?.get(m.farmerId) ?? 0) > 0) st.buyersControl++;
    }
    stats.push(st);
    pace[r.ordinal] = r.status === "upcoming" ? [] : days.slice(0, r.dayNow ?? r.days);
    otherCrops[r.ordinal] = [...crops.entries()].sort((a, b) => b[1] - a[1]).map(([crop, count]) => ({ crop, count }));
  }

  // Round → round flow for every started pair (from < to).
  const transitions: RoundTransition[] = [];
  for (let i = 0; i < started.length; i++) for (let j = i + 1; j < started.length; j++) {
    const a = started[i], b = started[j];
    const cells = Object.fromEntries(ROUND_CATS.map((x) => [x, Object.fromEntries(ROUND_CATS.map((y) => [y, 0]))])) as RoundTransition["cells"];
    const boughtTo = Object.fromEntries(ROUND_CATS.map((x) => [x, 0])) as Record<RoundCat, number>;
    const sp = spend.get(b.ordinal);
    for (const m of test) {
      const ca = catOf(outcome(m, a.ordinal)), cb = catOf(outcome(m, b.ordinal));
      cells[ca][cb]++;
      if ((sp?.get(m.farmerId) ?? 0) > 0) boughtTo[ca]++;
    }
    transitions.push({ from: a.ordinal, to: b.ordinal, cells, boughtTo });
  }

  // Centre / region / district / village × round.
  type GeoAcc = Map<string, RoundGeoRow>;
  const geoAcc = { store: new Map() as GeoAcc, region: new Map() as GeoAcc, district: new Map() as GeoAcc, village: new Map() as GeoAcc };
  // Call-stats rows per round key (+ "all" = reached in any started round, latest reached outcome's channels).
  type CallAcc = { sub: string; test: number; reached: number; call: number; whatsapp: number; sms: number; inPerson: number };
  const keys = [...started.map((r) => String(r.ordinal)), "all"];
  const callAcc: Record<string, Record<"store" | "region" | "district" | "village", Map<string, CallAcc>>> = {};
  for (const k of keys) callAcc[k] = { store: new Map(), region: new Map(), district: new Map(), village: new Map() };
  const bumpGeo = (map: GeoAcc, key: string, label: string, sub: string, m: (typeof test)[number]) => {
    const g = map.get(key) ?? map.set(key, { label, sub, test: 0, r: {} }).get(key)!;
    g.test++;
    for (const r of started) {
      const o = outcome(m, r.ordinal);
      const c = g.r[r.ordinal] ?? (g.r[r.ordinal] = { reached: 0, interested: 0, bought: 0, recorded: 0 });
      if (o) c.recorded++;
      if (o?.reached) c.reached++;
      if (o?.response === "INTERESTED") c.interested++;
      if ((spend.get(r.ordinal)?.get(m.farmerId) ?? 0) > 0) c.bought++;
    }
  };
  const bumpCall = (map: Map<string, CallAcc>, key: string, sub: string, o: RoundOutcome | undefined) => {
    const c = map.get(key) ?? map.set(key, { sub, test: 0, reached: 0, call: 0, whatsapp: 0, sms: 0, inPerson: 0 }).get(key)!;
    c.test++;
    if (!o?.reached) return;
    c.reached++;
    if (o.mediums.includes("CALL")) c.call++;
    if (o.mediums.includes("WHATSAPP")) c.whatsapp++;
    if (o.mediums.includes("SMS")) c.sms++;
    if (o.mediums.includes("IN_PERSON")) c.inPerson++;
  };
  for (const m of test) {
    const l = locOf(m);
    const store = m.storeId != null ? sName.get(m.storeId) ?? "—" : "—";
    const region = locLabel(l.region), district = locLabel(l.district), vKey = `${locLabel(l.village)}\u0001${l.district ?? ""}`;
    bumpGeo(geoAcc.store, store, store, l.region ?? "", m);
    bumpGeo(geoAcc.region, region, region, "", m);
    bumpGeo(geoAcc.district, district, district, "", m);
    bumpGeo(geoAcc.village, vKey, locLabel(l.village), l.district ?? "", m);
    let latestReached: RoundOutcome | undefined;
    for (const r of started) {
      const o = outcome(m, r.ordinal);
      if (o?.reached) latestReached = o;
      const acc = callAcc[String(r.ordinal)];
      bumpCall(acc.store, store, l.region ?? "", o); bumpCall(acc.region, region, "", o); bumpCall(acc.district, district, "", o); bumpCall(acc.village, vKey, l.district ?? "", o);
    }
    const all = callAcc.all;
    bumpCall(all.store, store, l.region ?? "", latestReached); bumpCall(all.region, region, "", latestReached); bumpCall(all.district, district, "", latestReached); bumpCall(all.village, vKey, l.district ?? "", latestReached);
  }
  const geoRows = (map: GeoAcc, cap = Infinity) => [...map.values()].sort((a, b) => b.test - a.test || a.label.localeCompare(b.label)).slice(0, cap);
  const callRows = (map: Map<string, CallAcc>, cap = Infinity): CallRow[] => [...map.entries()]
    .map(([key, c]) => ({ store: key.split("\u0001")[0], ...c, pending: Math.max(0, c.test - c.reached) }))
    .sort((a, b) => b.test - a.test || a.store.localeCompare(b.store)).slice(0, cap);
  const callBy: RoundAnalytics["callBy"] = {};
  for (const k of keys) callBy[k] = { store: callRows(callAcc[k].store), region: callRows(callAcc[k].region), district: callRows(callAcc[k].district), village: callRows(callAcc[k].village, 300) };

  const callers = [...callerMap.values()]
    .sort((a, b) => Object.values(b.r).reduce((s, x) => s + x.recorded, 0) - Object.values(a.r).reduce((s, x) => s + x.recorded, 0))
    .slice(0, 40);

  return {
    rounds: rounds.map((r): RoundMeta => ({ ordinal: r.ordinal, name: r.name, start: r.start, end: r.end, status: r.status, coupons: r.coupons, days: r.days, dayNow: r.dayNow })),
    currentRound: d.cur, hasPhases: d.hasPhases, basisLabel: d.basisLabel,
    stats, transitions,
    geo: { store: geoRows(geoAcc.store), region: geoRows(geoAcc.region), district: geoRows(geoAcc.district), village: geoRows(geoAcc.village, 300) },
    callBy, pace, callers, otherCrops,
  };
}

/**
 * Export a campaign's audience to Excel — built from the SAME data the Analytics modal shows (via
 * getCampaignAnalytics), so the file matches the screen: sheet 1 = Call stats by centre (the headline
 * table), sheet 2 = the Value + Lifecycle × Store composition matrix. Respects the RM filter + scope.
 */
export async function exportCampaignAudienceXlsx(campaignId: number, campaignName: string, rms?: string[], locIn?: LocFilter): Promise<{ ok: boolean; filename?: string; b64?: string; error?: string }> {
  const a = await getCampaignAnalytics(campaignId, rms, locIn);
  if (!a.total) return { ok: false, error: "No enrolled farmers in your scope (and filters) for this campaign." };

  // Store → RM, for the required Store + RM columns (callByStore / matrix are keyed by short store name).
  const stores = await prisma.store.findMany({ select: { name: true, regionalManager: true } });
  const rmByName = new Map(stores.map((s) => [shortStoreName(s.name), (s.regionalManager ?? "").trim()]));
  const pct = (r: number, t: number) => (t ? Math.round((r / t) * 100) : 0);

  // Sheet 1 — Call stats by centre (mirrors the on-screen table, TEST group).
  const cbs = a.callByStore;
  const tot = cbs.reduce((t, s) => ({ test: t.test + s.test, reached: t.reached + s.reached, call: t.call + s.call, whatsapp: t.whatsapp + s.whatsapp, sms: t.sms + s.sms, inPerson: t.inPerson + s.inPerson, pending: t.pending + s.pending }),
    { test: 0, reached: 0, call: 0, whatsapp: 0, sms: 0, inPerson: 0, pending: 0 });
  const callSheet: (string | number)[][] = [
    ["Centre", "Region", "RM", "Test farmers", "Reached", "Reached %", "Call", "WhatsApp", "SMS", "In-person", "Pending"],
    ["All centres", "", "", tot.test, tot.reached, pct(tot.reached, tot.test), tot.call, tot.whatsapp, tot.sms, tot.inPerson, tot.pending],
    ...cbs.map((s) => [s.store, s.sub, rmByName.get(s.store) ?? "", s.test, s.reached, pct(s.reached, s.test), s.call, s.whatsapp, s.sms, s.inPerson, s.pending]),
  ];
  // Location sheets — same outreach columns keyed by Region / District / Village (TEST group).
  const locSheet = (first: string, rows: CallRow[], withSub?: string): (string | number)[][] => [
    [first, ...(withSub ? [withSub] : []), "Test farmers", "Reached", "Reached %", "Call", "WhatsApp", "SMS", "In-person", "Pending"],
    ...rows.map((s) => [s.store, ...(withSub ? [s.sub] : []), s.test, s.reached, pct(s.reached, s.test), s.call, s.whatsapp, s.sms, s.inPerson, s.pending]),
  ];

  // Sheet 2 — Value + Lifecycle × Store composition matrix.
  const V = a.valueCols, L = a.lifecycleCols;
  const vTot: Record<string, number> = {}, lTot: Record<string, number> = {};
  for (const r of a.matrix) { for (const c of V) vTot[c.key] = (vTot[c.key] ?? 0) + (r.value[c.key] ?? 0); for (const c of L) lTot[c.key] = (lTot[c.key] ?? 0) + (r.lifecycle[c.key] ?? 0); }
  const matrixSheet: (string | number)[][] = [
    ["Store", "Region", "RM", ...V.map((c) => c.label), "Segment Total", ...L.map((c) => c.label), "Lifecycle Total"],
    ["All stores", "", "", ...V.map((c) => vTot[c.key] ?? 0), a.total, ...L.map((c) => lTot[c.key] ?? 0), a.total],
    ...a.matrix.map((r) => [r.store, r.region, rmByName.get(r.store) ?? "", ...V.map((c) => r.value[c.key] ?? 0), r.total, ...L.map((c) => r.lifecycle[c.key] ?? 0), r.total]),
  ];

  // Round sheets — round-by-round summary, centre × round, and one row per TEST farmer with every round's outcome.
  const roundSheets: StyledSheetSpec[] = [];
  const rd = await loadRoundData(campaignId, rms, locIn);
  const ra = rd ? computeRoundAnalytics(rd) : null;
  if (ra && rd) {
    const started = ra.rounds.filter((r) => r.status !== "upcoming");
    const rLabel = (r: RoundMeta) => `R${r.ordinal} ${r.name}`;
    const pc = (x: number, t: number) => (t ? Math.round((x / t) * 1000) / 10 : 0);
    const summary: StyledCell[][] = [[
      "Round", "Status", "Start", "End", "Test farmers", "Outcome recorded", "Reached", "Reached %", "Unreachable",
      "Call", "WhatsApp", "SMS", "In-person", "Interested", "Not interested", "Wants another crop", "Reached, no response logged",
      `Reached who bought campaign products in round (${ra.basisLabel})`, "Reached %buy", "Not reached %buy", "Control %buy",
      "Interested who bought", "Campaign-product sales by reached (₹, base)", "Coupon redeemers", "Coupon revenue (₹, base)",
    ]];
    for (const r of ra.rounds) {
      const s = ra.stats.find((x) => x.ordinal === r.ordinal)!;
      const up = r.status === "upcoming";
      summary.push([
        rLabel(r), up ? "Upcoming" : r.status === "current" ? "Current" : "Finished", r.start, r.end, s.test,
        up ? null : s.recorded, up ? null : s.reached, up ? null : pc(s.reached, s.test), up ? null : s.unreachable,
        up ? null : s.call, up ? null : s.whatsapp, up ? null : s.sms, up ? null : s.inPerson,
        up ? null : s.interested, up ? null : s.notInterested, up ? null : s.otherCrop, up ? null : s.noResponse,
        up ? null : s.buyersReached, up ? null : pc(s.buyersReached, s.reached), up ? null : pc(s.buyersNotReached, s.test - s.reached), up ? null : pc(s.buyersControl, s.control),
        up ? null : s.interestedBought, up ? null : Math.round(s.salesReached), s.couponRedeemers, s.couponRevenue != null ? Math.round(s.couponRevenue) : null,
      ]);
    }
    roundSheets.push({ name: "Rounds summary", rows: summary, leftCols: [0, 1], wrapHeaders: true });

    const geoHead: StyledCell[] = ["Centre", "Region", "RM", "Test farmers", ...started.flatMap((r) => [`R${r.ordinal} reached`, `R${r.ordinal} reached %`, `R${r.ordinal} interested`, `R${r.ordinal} bought campaign products`])];
    roundSheets.push({
      name: "Round by centre", leftCols: [0, 1, 2], wrapHeaders: true,
      rows: [geoHead, ...ra.geo.store.map((g) => [g.label, g.sub, rmByName.get(g.label) ?? "", g.test,
        ...started.flatMap((r) => { const c = g.r[r.ordinal]; return [c?.reached ?? 0, pc(c?.reached ?? 0, g.test), c?.interested ?? 0, c?.bought ?? 0]; })])],
    });

    const MEDL: Record<string, string> = { CALL: "Call", WHATSAPP: "WhatsApp", SMS: "SMS", IN_PERSON: "In-person", UNREACHABLE: "Unreachable" };
    const RESPL: Record<string, string> = { INTERESTED: "Interested", NOT_INTERESTED: "Not interested", OTHER_CROP: "Other crop" };
    const ts = (dt: Date | null) => (dt ? new Date(dt.getTime() + 330 * 60_000).toISOString().slice(0, 16).replace("T", " ") : "");
    const fHead: StyledCell[] = ["Farmer", "Mobile", "Village", "District", "Region", "Store code", "Store", "RM", "Value segment", "Lifecycle", "Reached in any round",
      ...started.flatMap((r) => [`R${r.ordinal} reached`, `R${r.ordinal} channels`, `R${r.ordinal} response`, `R${r.ordinal} comment`, `R${r.ordinal} recorded by`, `R${r.ordinal} recorded at (IST)`, `R${r.ordinal} campaign-product purchase in round (₹, base)`])];
    const per = 7, commentCols = started.map((_, i) => 11 + i * per + 3);
    const fRows: StyledCell[][] = rd.test.map((m) => {
      const f = rd.fMap.get(m.farmerId), l = rd.locOf(m);
      const outs = started.map((r) => rd.outcome(m, r.ordinal));
      return [
        f?.name ?? `Farmer #${m.farmerId}`, f?.mobile ?? "", l.village ?? "", l.district ?? "", l.region ?? "",
        m.storeId != null ? rd.sCode.get(m.storeId) ?? "" : "", m.storeId != null ? rd.sName.get(m.storeId) ?? "" : "", m.storeId != null ? rd.sRm.get(m.storeId) ?? "" : "",
        segMeta(valueKeyOf(m)).label, segMeta(lifecycleKeyOf(m)).label, outs.some((o) => o?.reached) ? "Yes" : "No",
        ...started.flatMap((r, i) => {
          const o = outs[i];
          const buy = rd.spend.get(r.ordinal)?.get(m.farmerId) ?? 0;
          return [o ? (o.reached ? "Yes" : "No") : "Not contacted", o ? o.mediums.map((x) => MEDL[x] ?? x).join(", ") : "",
            o?.response ? `${RESPL[o.response] ?? o.response}${o.response === "OTHER_CROP" && o.responseCrop ? ` (${cropLabel(o.responseCrop)})` : ""}` : "",
            o?.comment ?? "", o?.reachedBy ? `${o.reachedBy}${o.reachedByCode ? ` (${o.reachedByCode})` : ""}` : "", ts(o?.reachedAt ?? null), buy ? Math.round(buy) : null];
        }),
      ];
    });
    roundSheets.push({ name: "Farmers round by round", rows: [fHead, ...fRows], leftCols: [0, 1, 2, 3, 4, 5, 6, 7], wrapCols: commentCols, wrapHeaders: true });
  }

  const safe = (campaignName || "campaign").replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 60) || "campaign";
  const b64 = await buildStyledWorkbookB64([
    { name: "Call stats by centre", rows: callSheet, leftCols: [0, 1, 2], boldRows: [1] }, // Centre, Region, RM text; totals row bold
    { name: "Call stats by region", rows: locSheet("Region", a.callByLocation.region), leftCols: [0] },
    { name: "Call stats by district", rows: locSheet("District", a.callByLocation.district), leftCols: [0] },
    { name: "Call stats by village", rows: locSheet("Village", a.callByLocation.village, "District"), leftCols: [0, 1] },
    { name: "Value + Lifecycle x Store", rows: matrixSheet, leftCols: [0, 1, 2], boldRows: [1] },
    ...roundSheets,
  ]);
  return { ok: true, filename: `${safe} - analytics.xlsx`, b64 };
}

const CONTACT_MEDIA = new Set(["CALL", "WHATSAPP", "SMS", "IN_PERSON"]); // a channel ⇒ reached
const OUTCOMES = new Set([...CONTACT_MEDIA, "UNREACHABLE"]); // valid channel/outcome values (UNREACHABLE = parked, not reached)
const RESPONSES = new Set(["INTERESTED", "NOT_INTERESTED", "OTHER_CROP"]); // interest outcome — any ⇒ reached

/**
 * Officer/RM (or central) records an outreach outcome:
 *   - `mediums`: HOW they were reached — CALL|WHATSAPP|SMS|IN_PERSON (multi-select), or the exclusive
 *     UNREACHABLE (couldn't contact).
 *   - `response`: the INTEREST outcome — INTERESTED | NOT_INTERESTED | OTHER_CROP (+ `responseCrop` for the last).
 * `reached` is DERIVED (never trusted from the client): any channel OR any interest response ⇒ reached.
 * A response and UNREACHABLE are contradictory — recording one clears the other. Scope-guarded to own store/zone.
 */
export async function markCampaignMember(
  memberId: number,
  patch: { mediums?: string[] | null; comment?: string | null; response?: string | null; responseCrop?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const { role, storeId, managedStoreIds, userId } = await getScope();
  const member = await prisma.campaignMember.findUnique({ where: { id: memberId }, select: { storeId: true, zone: true, group: true, mediums: true, response: true, campaignId: true } });
  if (!member) return { ok: false, error: "Member not found." };
  // Officers/RMs may only touch members they can see on this campaign (campaignFieldAccess: own/managed stores,
  // the picked team, helper grants); campaigners only their assigned campaigns; central/sysadmin any.
  if (role === "officer" || role === "regional") {
    const access = await campaignFieldAccess(member.campaignId);
    if (access !== "all" && (member.storeId == null || !access.includes(member.storeId)))
      return { ok: false, error: role === "officer" ? "This farmer isn't in your store." : "This farmer isn't in a store you manage." };
  }
  else if (role === "campaigner") {
    const assigned = userId != null ? await prisma.campaignCaller.count({ where: { userId, campaignId: member.campaignId } }) : 0;
    if (!assigned) return { ok: false, error: "This campaign isn't assigned to you." };
  }
  else if (!canManage(role)) return { ok: false, error: "Not authorised." };
  if (member.group !== "TEST") return { ok: false, error: "This farmer is a control holdout — not contacted." };

  const data: Prisma.CampaignMemberUpdateInput = {};
  let effMediums = member.mediums;
  let effResponse: string | null = member.response;
  let outcomeTouched = false;
  let auditLine: string | null = null;
  let auditActor: string | undefined;

  if (patch.mediums !== undefined) {
    // Normalise to a validated, de-duplicated set — the client may send anything.
    const meds = [...new Set((patch.mediums ?? []).map((m) => String(m).trim().toUpperCase()).filter(Boolean))];
    if (meds.some((m) => !OUTCOMES.has(m))) return { ok: false, error: "Pick Call, WhatsApp, SMS, In-person or Unreachable." };
    if (meds.includes("UNREACHABLE") && meds.length > 1) return { ok: false, error: "Unreachable can't be combined with a channel." };
    effMediums = meds; outcomeTouched = true;
  }
  if (patch.response !== undefined) {
    const resp = patch.response ? String(patch.response).trim().toUpperCase() : null;
    if (resp && !RESPONSES.has(resp)) return { ok: false, error: "Pick Interested, Not interested, or Other crop." };
    effResponse = resp; outcomeTouched = true;
    if (resp === "OTHER_CROP") {
      const crop = (patch.responseCrop ?? "").trim().toLowerCase();
      if (!crop) return { ok: false, error: "Pick which crop they're interested in." };
      data.responseCrop = crop;
    } else {
      data.responseCrop = null; // crop only meaningful for OTHER_CROP
    }
  } else if (patch.responseCrop !== undefined && member.response === "OTHER_CROP") {
    // Crop changed while staying on OTHER_CROP.
    const crop = (patch.responseCrop ?? "").trim().toLowerCase();
    if (!crop) return { ok: false, error: "Pick which crop they're interested in." };
    data.responseCrop = crop;
  }

  if (outcomeTouched) {
    // Reconcile the two dimensions: a real response means contact was made (drop UNREACHABLE);
    // marking UNREACHABLE means no conversation (drop any response).
    if (effResponse && RESPONSES.has(effResponse)) effMediums = effMediums.filter((m) => m !== "UNREACHABLE");
    if (effMediums.includes("UNREACHABLE")) effResponse = null;

    data.mediums = effMediums;
    data.response = effResponse;
    if (!effResponse) data.responseCrop = null;

    const reached = effMediums.some((m) => CONTACT_MEDIA.has(m)) || effResponse != null;
    const recorded = effMediums.length > 0 || effResponse != null;
    data.reached = reached;
    data.reachedAt = recorded ? new Date() : null; // when the outcome was recorded
    const actor = await getActor(); // audit: the ACTUAL logged-in user, never the impersonated persona
    data.reachedBy = recorded ? actor.name : null;
    data.reachedByCode = recorded ? actor.code : null;
    if (recorded) { auditActor = actor.name; auditLine = `Recorded campaign outreach: ${effMediums.join(", ") || "—"}${effResponse ? ` · ${effResponse}` : ""}`; }
  }
  if (patch.comment !== undefined) data.comment = patch.comment?.trim() ? patch.comment.trim().slice(0, 500) : null;
  try {
    await prisma.campaignMember.update({ where: { id: memberId }, data });
    if (auditLine) await logAudit("Campaign", "UPDATE", auditLine, auditActor);
    revalidatePath("/campaigns");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed" };
  }
}

/* ── Attribution: which purchases count as "campaign revenue" ── */
interface ProductFilter { crops: string[]; categories: string[]; all: boolean }

/** Mirror a campaign's segment filters into the products that count as campaign-related. */
function productFilterOf(criteria: ClusterCriteria[]): ProductFilter {
  const crops = new Set<string>(), cats = new Set<string>();
  for (const c of criteria) {
    for (const x of criteriaCrops(c)) crops.add(x);
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

/** Sum matched line revenue (base/pre-tax = SaleLine.basic) per farmer, chunked to protect the pooled DB. */
async function matchedSpendByFarmer(pf: ProductFilter, farmerIds: number[], start: Date, end: Date): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  for (let i = 0; i < farmerIds.length; i += 15000) {
    const slice = farmerIds.slice(i, i + 15000);
    const rows = await prisma.saleLine.groupBy({ by: ["farmerId"], where: matchedLineWhere(pf, slice, start, end), _sum: { basic: true } });
    for (const r of rows) if (r.farmerId != null) out.set(r.farmerId, Math.round(r._sum.basic ?? 0));
  }
  return out;
}

/** SaleLine `where` for lines that redeemed any of `codes` (item OR invoice coupon) in [start,end].
 *  Matches by PREFIX: the ERP appends a unique per-redemption suffix to each code
 *  (ALOO150 → ALOO15049P5ME3), so a round code credits every sale whose coupon starts with it.
 *  Codes are pre-normalised to upper-case by the callers; stored coupon values are upper-case too. */
function couponLineWhere(codes: string[], start: Date, end: Date, farmerIds?: number[]): Prisma.SaleLineWhereInput {
  if (!codes.length) return { id: -1 }; // never matches — guards an empty-OR
  return {
    source: "REAL", soldAt: { gte: start, lte: end },
    ...(farmerIds ? { farmerId: { in: farmerIds } } : {}),
    OR: codes.flatMap((c) => [{ itemCouponCode: { startsWith: c } }, { invoiceCouponCode: { startsWith: c } }]),
  };
}

/** Base (pre-tax) coupon-redeemed spend per farmer for the given codes/window — the hard coupon signal. */
async function couponSpendByFarmer(codes: string[], farmerIds: number[], start: Date, end: Date): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!codes.length || !farmerIds.length) return out;
  for (let i = 0; i < farmerIds.length; i += 15000) {
    const slice = farmerIds.slice(i, i + 15000);
    const rows = await prisma.saleLine.groupBy({ by: ["farmerId"], where: couponLineWhere(codes, start, end, slice), _sum: { basic: true } });
    for (const r of rows) if (r.farmerId != null) out.set(r.farmerId, Math.round(r._sum.basic ?? 0));
  }
  return out;
}

// ── Uplift builder (test/control purchase-rate lift), shared by the campaign-wide and per-round views ──
type UpliftMemberVM = { farmerId: number; segment: string | null; valueSegment: string | null; lifecycleSegment: string | null; group: string; reached: boolean };
const valueKeyOf = (m: UpliftMemberVM) => m.valueSegment ?? (VALUE_SEGMENTS.includes(m.segment as never) ? (m.segment as string) : "REGULAR");
const lifecycleKeyOf = (m: UpliftMemberVM) => m.lifecycleSegment ?? (LIFECYCLE_SEGMENTS.includes(m.segment as never) ? (m.segment as string) : "LAPSED");

/* ── Segment × view attribution table (Shilpa's dashboard spec, 2026-09-16) ──
 * Per value/lifecycle segment: Test/Reach/Buy counts, Test%Buy, Reach%Buy, Control%Buy,
 * RELATIVE uplift % = (reach%buy − ctrl%buy)/reach%buy, and incremental = uplift × total sales.
 * Three "match" views drive what counts as a BUY (coupon-redeemed / crop-matched / any transaction);
 * TOTAL SALES is always every transaction (view-independent), shown for all-test (a) and reached (b).
 * Leads / No-spend get NO uplift — their whole sales count as incremental. */
export type MatchView = "coupon" | "crop" | "total";
export interface SegViewCell {
  buy: number;            // reached TEST who bought (this view)
  testPctBuy: number;     // buy / test  (%, 1-dp)
  reachPctBuy: number;    // buy / reached  (%, 1-dp)
  controlBuy: number;     // control who bought (this view)
  controlPctBuy: number;  // controlBuy / control  (%, 1-dp)
  upliftPct: number | null; // relative uplift % (1-dp); null = n/a (coupon view, reach%=0, or a leads row)
  incrAllTest: number;    // COUPON view: coupon revenue redeemed; else uplift × total-sales (leads: = total sales)
  incrReached: number;    // same basis, reached-test subset
}
export interface SegRow {
  segment: string; isLeads: boolean;
  test: number; reached: number; control: number;
  totalSalesAllTest: number; totalSalesReached: number; // all transactions (base ₹), view-independent
  views: Record<MatchView, SegViewCell>;
}
export interface TrackerScope {
  key: string; label: string;               // "overall"/"All rounds" · "R1"/"Round 1 · Discount"
  windowStart: string; windowEnd: string;    // dates + 30-day tail
  couponCodes: string[];
  byValue: SegRow[]; byLifecycle: SegRow[];
}

const MV: MatchView[] = ["coupon", "crop", "total"];

/** Build one scope's segment tables (overall campaign or one round) across all three match views. */
async function computeScope(members: UpliftMemberVM[], pf: ProductFilter, codes: string[], ws: Date, we: Date, key: string, label: string): Promise<TrackerScope> {
  const allIds = [...new Set(members.map((m) => m.farmerId))];
  const [allSpend, cropSpend, couponSpend] = await Promise.all([
    matchedSpendByFarmer({ crops: [], categories: [], all: true }, allIds, ws, we), // every transaction
    pf.all ? Promise.resolve<Map<number, number> | null>(null) : matchedSpendByFarmer(pf, allIds, ws, we),
    codes.length ? couponSpendByFarmer(codes, allIds, ws, we) : Promise.resolve(new Map<number, number>()),
  ]);
  const cropMap = cropSpend ?? allSpend; // non-product-specific campaign → crop view == all transactions
  const boughtIn = (fid: number, v: MatchView) => ((v === "total" ? allSpend : v === "crop" ? cropMap : couponSpend).get(fid) ?? 0) > 0;

  const build = (keyOf: (m: UpliftMemberVM) => string, order: readonly string[]): SegRow[] => {
    type Acc = { test: number; reached: number; control: number; totAll: number; totReached: number; cpAll: number; cpReached: number; buy: Record<MatchView, number>; cbuy: Record<MatchView, number> };
    const mk = (): Acc => ({ test: 0, reached: 0, control: 0, totAll: 0, totReached: 0, cpAll: 0, cpReached: 0, buy: { coupon: 0, crop: 0, total: 0 }, cbuy: { coupon: 0, crop: 0, total: 0 } });
    const bySeg = new Map<string, Acc>();
    for (const m of members) {
      const k = keyOf(m); const a = bySeg.get(k) ?? mk();
      const spend = allSpend.get(m.farmerId) ?? 0;
      const cp = couponSpend.get(m.farmerId) ?? 0; // ₹ this farmer redeemed on a campaign coupon
      if (m.group === "TEST") {
        a.test++; a.totAll += spend; a.cpAll += cp;
        if (m.reached) { a.reached++; a.totReached += spend; a.cpReached += cp; for (const v of MV) if (boughtIn(m.farmerId, v)) a.buy[v]++; }
      } else { a.control++; for (const v of MV) if (boughtIn(m.farmerId, v)) a.cbuy[v]++; }
      bySeg.set(k, a);
    }
    return order.filter((k) => bySeg.has(k)).map((segment): SegRow => {
      const a = bySeg.get(segment)!;
      const isLeads = segment === "NO_SPEND" || segment === "LEAD";
      const views = {} as Record<MatchView, SegViewCell>;
      for (const v of MV) {
        const reachRatio = a.reached > 0 ? a.buy[v] / a.reached : 0;
        const ctrlRatio = a.control > 0 ? a.cbuy[v] / a.control : 0;
        // COUPON view: control can never redeem a code, so a test-vs-control uplift is meaningless
        // (it would always read 100%). Incremental here = the actual coupon revenue redeemed, not
        // uplift × total sales. CROP / TOTAL views keep the relative-uplift attribution.
        const isCoupon = v === "coupon";
        const uplift = isCoupon || isLeads || reachRatio <= 0 ? null : (reachRatio - ctrlRatio) / reachRatio;
        views[v] = {
          buy: a.buy[v],
          testPctBuy: a.test > 0 ? Math.round((a.buy[v] / a.test) * 1000) / 10 : 0,
          reachPctBuy: Math.round(reachRatio * 1000) / 10,
          controlBuy: a.cbuy[v],
          controlPctBuy: Math.round(ctrlRatio * 1000) / 10,
          upliftPct: uplift != null ? Math.round(uplift * 1000) / 10 : null,
          incrAllTest: isCoupon ? Math.round(a.cpAll) : isLeads ? Math.round(a.totAll) : uplift != null ? Math.round(uplift * a.totAll) : 0,
          incrReached: isCoupon ? Math.round(a.cpReached) : isLeads ? Math.round(a.totReached) : uplift != null ? Math.round(uplift * a.totReached) : 0,
        };
      }
      return { segment, isLeads, test: a.test, reached: a.reached, control: a.control, totalSalesAllTest: Math.round(a.totAll), totalSalesReached: Math.round(a.totReached), views };
    });
  };
  return { key, label, windowStart: iso(ws)!, windowEnd: iso(we)!, couponCodes: codes, byValue: build(valueKeyOf, VALUE_SEGMENTS), byLifecycle: build(lifecycleKeyOf, LIFECYCLE_SEGMENTS) };
}

export interface ReachRow { store: string; sub: string; reached: number; total: number; broadcast: number }
export interface CampaignReach {
  testTotal: number; reached: number;
  byApproach: { CALL: number; WHATSAPP: number; SMS: number; IN_PERSON: number; unspecified: number };
  byResponse: { interested: number; notInterested: number; otherCrop: number; noResponse: number };
  otherCrops: { crop: string; count: number }[]; // crops requested via "interested in another crop"
  byStore: { store: string; reached: number; total: number; broadcast: number }[]; // outreach progress per store (TEST group)
  /** Same progress by farmer location (TEST group). Village rows capped at the top 300. */
  byLocation: { region: ReachRow[]; district: ReachRow[]; village: ReachRow[] };
  broadcastDelivered: number; // TEST members a mass send DELIVERED to (separate from individual `reached`)
  byBroadcastChannel: { SMS: number; WHATSAPP: number };
}
export interface CampaignAttribution {
  basisLabel: string; crops: string[]; categories: string[]; all: boolean; noCatalogMatch: boolean;
  windowStart: string; windowEnd: string;
}
export interface CampaignTracker {
  reach: CampaignReach;
  attribution: CampaignAttribution;
  scopes: TrackerScope[]; // [0] = overall (all rounds); then one per round
  locItems: LocItem[];    // Region/District/Village combinations of ALL members — filter options
  locFiltered: boolean;   // a location filter narrowed everything above
}

/**
 * Campaign Tracker (managers only): outreach reach + real attributed revenue + test/control uplift.
 * Attributed revenue = matched purchases (segment-mirrored products) by CONTACTED (reached) TEST farmers,
 * over the window [campaign start, campaign end + 30 days]. Populated as monthly sales are imported.
 */
export async function getCampaignTracker(campaignId: number, locIn?: LocFilter): Promise<CampaignTracker | null> {
  const loc = sanitizeLoc(locIn);
  const { role } = await getScope();
  if (!canManage(role)) return null; // officers/RMs execute via the scoped farmer list, not the tracker
  const camp = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!camp) return null;

  // Resolve the campaign's segment criteria (its chosen clusters, or every cluster in its project).
  const clusterIds = (await resolveCampaignClusters([camp])).get(camp) ?? [];
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

  const liveMembers = await prisma.campaignMember.findMany({ where: { campaignId }, select: { id: true, farmerId: true, segment: true, valueSegment: true, lifecycleSegment: true, group: true, reached: true, mediums: true, response: true, responseCrop: true, storeId: true, broadcastMediums: true } });
  // Reach is cumulative across rounds: a farmer not (yet) reached this round but reached in an earlier one
  // counts with that earlier outcome — so advancing a round never drops them from reach or uplift.
  const earlier = await earlierReached(campaignId);
  const allMembers = liveMembers.map((m) => {
    const e = !m.reached ? earlier.get(m.id) : undefined;
    return e ? { ...m, reached: true, mediums: e.mediums, response: e.response, responseCrop: e.responseCrop } : m;
  });
  // Location of every member (village/district from the farmer, region = enrolled store's zone) → options + optional filter.
  const [locFarmers, locStores] = await Promise.all([
    prisma.farmer.findMany({ where: { id: { in: [...new Set(allMembers.map((m) => m.farmerId))] } }, select: { id: true, village: true, district: true } }),
    prisma.store.findMany({ select: { id: true, zone: true } }),
  ]);
  const lfMap = new Map(locFarmers.map((f) => [f.id, f]));
  const lzMap = new Map(locStores.map((s) => [s.id, locVal(s.zone)]));
  const locOf = (m: { farmerId: number; storeId: number | null }) => {
    const f = lfMap.get(m.farmerId);
    return { village: locVal(f?.village), district: locVal(f?.district), region: m.storeId != null ? lzMap.get(m.storeId) ?? null : null };
  };
  const locItems = locItemsOf(allMembers.map(locOf));
  const inLoc = locMatcher(loc);
  const members = loc ? allMembers.filter((m) => inLoc(locOf(m))) : allMembers;
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
  // Interest response breakdown over the reached TEST farmers + the "other crop" requests.
  const byResponse = { interested: 0, notInterested: 0, otherCrop: 0, noResponse: 0 };
  const otherCropTally = new Map<string, number>();
  for (const m of reachedMembers) {
    if (m.response === "INTERESTED") byResponse.interested++;
    else if (m.response === "NOT_INTERESTED") byResponse.notInterested++;
    else if (m.response === "OTHER_CROP") { byResponse.otherCrop++; if (m.responseCrop) otherCropTally.set(m.responseCrop, (otherCropTally.get(m.responseCrop) ?? 0) + 1); }
    else byResponse.noResponse++;
  }
  const otherCrops = [...otherCropTally.entries()].sort((a, b) => b[1] - a[1]).map(([crop, count]) => ({ crop, count }));

  // Per-store outreach progress + broadcast delivery (TEST group). Store names resolved from Store.
  const storeIds = [...new Set(test.map((m) => m.storeId).filter((x): x is number => x != null))];
  const storeNames = new Map((await prisma.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, name: true } })).map((s) => [s.id, shortStoreName(s.name)]));
  const storeAgg = new Map<string, { store: string; reached: number; total: number; broadcast: number }>();
  const byBroadcastChannel = { SMS: 0, WHATSAPP: 0 };
  let broadcastDelivered = 0;
  for (const m of test) {
    const store = m.storeId != null ? storeNames.get(m.storeId) ?? "—" : "— No store";
    const a = storeAgg.get(store) ?? { store, reached: 0, total: 0, broadcast: 0 };
    a.total++;
    if (m.reached) a.reached++;
    const bc = m.broadcastMediums ?? [];
    if (bc.length) { a.broadcast++; broadcastDelivered++; if (bc.includes("SMS")) byBroadcastChannel.SMS++; if (bc.includes("WHATSAPP")) byBroadcastChannel.WHATSAPP++; }
    storeAgg.set(store, a);
  }
  const byStore = [...storeAgg.values()].sort((a, b) => b.total - a.total || a.store.localeCompare(b.store));
  // Same progress by location.
  const locAgg = { region: new Map<string, ReachRow>(), district: new Map<string, ReachRow>(), village: new Map<string, ReachRow>() };
  const bump = (map: Map<string, ReachRow>, key: string, label: string, sub: string, m: (typeof test)[number]) => {
    const a = map.get(key) ?? map.set(key, { store: label, sub, reached: 0, total: 0, broadcast: 0 }).get(key)!;
    a.total++;
    if (m.reached) a.reached++;
    if ((m.broadcastMediums ?? []).length) a.broadcast++;
  };
  for (const m of test) {
    const l = locOf(m);
    bump(locAgg.region, locLabel(l.region), locLabel(l.region), "", m);
    bump(locAgg.district, locLabel(l.district), locLabel(l.district), "", m);
    bump(locAgg.village, `${l.village ?? ""}\u0001${l.district ?? ""}`, locLabel(l.village), l.district ?? "", m);
  }
  const reachRows = (map: Map<string, ReachRow>, cap = Infinity) => [...map.values()].sort((a, b) => b.total - a.total || a.store.localeCompare(b.store)).slice(0, cap);
  const byLocation = { region: reachRows(locAgg.region), district: reachRows(locAgg.district), village: reachRows(locAgg.village, 300) };

  // ── Segment × view scopes: overall (all rounds) + one per round ──────────────────────────────────
  const phases = await prisma.campaignPhase.findMany({ where: { campaignId }, orderBy: { ordinal: "asc" } });
  const codesOf = (p: (typeof phases)[number]) => [...new Set(asCoupons(p.coupons).map((c) => c.code.trim().toUpperCase()).filter(Boolean))];
  const allCodes = [...new Set(phases.flatMap(codesOf))];
  const scopes: TrackerScope[] = [];
  scopes.push(await computeScope(members, pf, allCodes, start, end, "overall", "All rounds"));
  for (const p of phases) {
    const rEnd = new Date(p.defaultEnd); rEnd.setDate(rEnd.getDate() + 30); // +30-day grace tail
    scopes.push(await computeScope(members, pf, codesOf(p), p.defaultStart, rEnd, `R${p.ordinal}`, `Round ${p.ordinal} · ${p.name}`));
  }

  const basisLabel = pf.all
    ? "All purchases (cluster isn't product-specific)"
    : [pf.crops.length ? `Crop: ${pf.crops.map(cropLabel).join(", ")}` : "", pf.categories.length ? `Category: ${pf.categories.join(", ")}` : ""].filter(Boolean).join(" · ");

  return {
    reach: { testTotal: test.length, reached: reachedMembers.length, byApproach, byResponse, otherCrops, byStore, byLocation, broadcastDelivered, byBroadcastChannel },
    attribution: { basisLabel, crops: pf.crops, categories: pf.categories, all: pf.all, noCatalogMatch, windowStart: iso(start)!, windowEnd: iso(end)! },
    scopes,
    locItems,
    locFiltered: !!loc,
  };
}

/* ─────────────────────────── Campaign SMS (ZapSMS) ─────────────────────────── */

/** Whether the SMS gateway is configured (all env keys present). */
export async function smsConfigStatus(): Promise<{ ready: boolean; missing: string[] }> {
  const { ready, missing } = zapConfig();
  return { ready, missing };
}

/** Fill the comm-plan placeholders with real data; return the text + which slots had no data. */
function fillSmsTemplate(
  template: string,
  d: { name?: string | null; gap?: number | null; lastItem?: string | null; store?: string | null; number?: string | null; date?: string | null },
): { text: string; missing: string[] } {
  const first = (d.name ?? "").trim().split(/\s+/)[0] || "";
  const gapStr = d.gap != null && d.gap > 0 ? Math.round(d.gap).toLocaleString("en-IN") : "";
  const tokens: { re: RegExp; val: string; label: string }[] = [
    { re: /\[(?:name|Naam)\]/gi, val: first, label: "farmer name" },
    { re: /\[gap\]/g, val: gapStr, label: "amount to reach HNI" },
    { re: /\[last item\]/gi, val: (d.lastItem ?? "").trim(), label: "last purchased item" },
    { re: /\[Store name\]/gi, val: (d.store ?? "").trim(), label: "store name" },
    { re: /\[number\]/gi, val: (d.number ?? "").trim(), label: "contact number" },
    { re: /\[date\]/gi, val: (d.date ?? "").trim(), label: "date" },
  ];
  let text = template;
  const missing: string[] = [];
  for (const t of tokens) {
    const present = new RegExp(t.re.source, t.re.flags.replace("g", "")).test(text);
    if (!present) continue;
    if (t.val) text = text.replace(t.re, t.val);
    else if (!missing.includes(t.label)) missing.push(t.label);
  }
  return { text, missing };
}

export interface SmsPrepared {
  ok: boolean; error?: string;
  message?: string; missing?: string[]; mobile?: string | null;
  templateName?: string; smsReady?: boolean; dltReady?: boolean;
}

/** Load a member + comm template, fill placeholders from real data, and report anything missing. */
export async function prepareCampaignSms(input: { memberId: number; commTemplateId: number }): Promise<SmsPrepared> {
  // SMS sending is restricted to admins / super admins (Central Admin + System Admin).
  if (!(await requireManager()).ok) return { ok: false, error: "SMS is available to admins only." };
  const scope = await memberScopeWhere();
  if (scope === "none") return { ok: false, error: "Not authorised." };
  try {
    const member = await prisma.campaignMember.findFirst({
      where: { id: input.memberId, ...(scope ?? {}) },
      select: { farmerId: true, campaign: { select: { endDate: true } } },
    });
    if (!member) return { ok: false, error: "Member not found or out of your scope." };
    const tpl = await prisma.commTemplate.findUnique({ where: { id: input.commTemplateId }, select: { name: true, template: true, dltTemplateId: true, smsVariables: true } });
    if (!tpl) return { ok: false, error: "Comm plan not found." };

    const [farmer, lastSale, actorMobileRow] = await Promise.all([
      prisma.farmer.findUnique({ where: { id: member.farmerId }, select: { name: true, mobile: true, hniGap: true, village: true, crop: true, cropTags: true, store: { select: { name: true } } } }),
      prisma.sale.findFirst({ where: { farmerId: member.farmerId, soldAt: { not: null } }, orderBy: { soldAt: "desc" }, select: { items: true } }),
      (async () => { const s = await getSession(); return s ? prisma.user.findUnique({ where: { id: s.userId }, select: { mobile: true } }) : null; })(),
    ]);
    const store = farmer?.store?.name ? shortStoreName(farmer.store.name) : "";
    const dateStr = member.campaign?.endDate ? new Date(member.campaign.endDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }) : "";

    // DLT model: locked template with {#var#} positions mapped in smsVariables. Legacy plans: named [slots].
    const isDlt = (tpl.smsVariables?.length ?? 0) > 0 || /\{#var#\}/i.test(tpl.template);
    let text: string, missing: string[];
    if (isDlt) {
      const src: FarmerVarSource = { name: farmer?.name ?? null, mobile: farmer?.mobile ?? null, village: farmer?.village ?? null, hniGap: farmer?.hniGap ?? null, cropTags: farmer?.cropTags ?? [], crop: farmer?.crop ?? null, storeName: farmer?.store?.name ?? null };
      const vars = resolveVars(src, member.campaign?.endDate ?? null);
      text = fillDltTemplate(tpl.template, tpl.smsVariables, vars);
      // Flag mapped positions that resolve empty (e.g. no name/village on file).
      const n = countDltVars(tpl.template);
      missing = Array.from({ length: n }, (_, i) => tpl.smsVariables?.[i]).filter((k): k is string => !!k && !vars[k]).map((k) => VAR_LABEL[k] ?? k);
    } else {
      const r = fillSmsTemplate(tpl.template, { name: farmer?.name, gap: farmer?.hniGap, lastItem: (lastSale?.items ?? "").split(" · ")[0], store, number: actorMobileRow?.mobile, date: dateStr });
      text = r.text; missing = r.missing;
    }
    return { ok: true, message: text, missing, mobile: farmer?.mobile ?? null, templateName: tpl.name, smsReady: zapConfig().ready, dltReady: !!tpl.dltTemplateId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not prepare the message." };
  }
}

/** Send the SMS via ZapSMS, log it, and mark the member reached-by-SMS on success. */
export async function sendCampaignSms(input: { memberId: number; commTemplateId?: number | null; message: string }): Promise<{ ok: boolean; error?: string; providerId?: string }> {
  // SMS sending is restricted to admins / super admins (Central Admin + System Admin).
  if (!(await requireManager()).ok) return { ok: false, error: "SMS is available to admins only." };
  const scope = await memberScopeWhere();
  if (scope === "none") return { ok: false, error: "Not authorised." };
  const message = (input.message ?? "").trim();
  if (!message) return { ok: false, error: "Message is empty." };
  try {
    const member = await prisma.campaignMember.findFirst({
      where: { id: input.memberId, ...(scope ?? {}) },
      select: { id: true, farmerId: true, campaignId: true, mediums: true },
    });
    if (!member) return { ok: false, error: "Member not found or out of your scope." };
    const farmer = await prisma.farmer.findUnique({ where: { id: member.farmerId }, select: { mobile: true } });
    const mobile = farmer?.mobile ?? "";
    if (!mobile) return { ok: false, error: "No phone number on file for this farmer." };

    const tpl = input.commTemplateId
      ? await prisma.commTemplate.findUnique({ where: { id: input.commTemplateId }, select: { dltTemplateId: true } })
      : null;

    const actor = await getActor();
    const { cfg } = zapConfig();
    const res = await sendSms({ mobile, message, templateId: tpl?.dltTemplateId ?? null });

    await prisma.smsLog.create({
      data: {
        farmerId: member.farmerId, campaignId: member.campaignId, memberId: member.id, mobile,
        senderId: cfg.senderId || null, dltTemplateId: tpl?.dltTemplateId ?? null, message,
        ok: res.ok, providerId: res.providerId ?? null, status: res.status ?? null, error: res.error ?? null,
        sentByName: actor.name, sentByCode: actor.code,
      },
    });

    if (res.ok) {
      const mediums = member.mediums.includes("SMS") ? member.mediums : [...member.mediums.filter((m) => m !== "UNREACHABLE"), "SMS"];
      await prisma.campaignMember.update({
        where: { id: member.id },
        data: { reached: true, reachedAt: new Date(), mediums, reachedBy: actor.name, reachedByCode: actor.code },
      });
      await logAudit("SMS", "SEND", `Sent campaign SMS to ${mobile}`, actor.name);
      revalidatePath("/campaigns");
    }
    return { ok: res.ok, error: res.error, providerId: res.providerId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Send failed." };
  }
}

/* ─────────────────────────── WhatsApp (Meta Cloud API) ───────────────────────────
 * Mirrors the SMS path: prepare (fill placeholders) → send → log to WhatsAppLog → mark reached.
 * Restricted to admins / super admins. Text send by default; if the comm plan carries a
 * waTemplateName it sends as a template (Meta requires templates for cold outreach). */

export async function waConfigStatus(): Promise<{ ready: boolean; missing: string[] }> {
  const { ready, missing } = waConfig();
  return { ready, missing };
}

export interface WaPrepared {
  ok: boolean; error?: string;
  message?: string; missing?: string[]; mobile?: string | null;
  templateName?: string; waReady?: boolean; hasTemplate?: boolean;
}

/** Load a member + comm template, fill placeholders from real data, and report anything missing. */
export async function prepareCampaignWhatsApp(input: { memberId: number; commTemplateId: number }): Promise<WaPrepared> {
  if (!(await requireManager()).ok) return { ok: false, error: "WhatsApp is available to admins only." };
  const scope = await memberScopeWhere();
  if (scope === "none") return { ok: false, error: "Not authorised." };
  try {
    const member = await prisma.campaignMember.findFirst({
      where: { id: input.memberId, ...(scope ?? {}) },
      select: { farmerId: true, campaign: { select: { endDate: true } } },
    });
    if (!member) return { ok: false, error: "Member not found or out of your scope." };
    const tpl = await prisma.commTemplate.findUnique({ where: { id: input.commTemplateId }, select: { name: true, template: true, waTemplateName: true, waVariables: true } });
    if (!tpl) return { ok: false, error: "Comm plan not found." };

    const farmer = await prisma.farmer.findUnique({ where: { id: member.farmerId }, select: { name: true, mobile: true, hniGap: true, village: true, crop: true, cropTags: true, store: { select: { name: true } } } });
    // WA templates are {{n}}-based: fill positionally from the mapped farmer fields.
    const src: FarmerVarSource = { name: farmer?.name ?? null, mobile: farmer?.mobile ?? null, village: farmer?.village ?? null, hniGap: farmer?.hniGap ?? null, cropTags: farmer?.cropTags ?? [], crop: farmer?.crop ?? null, storeName: farmer?.store?.name ?? null };
    const vars = resolveVars(src, member.campaign?.endDate ?? null);
    const text = fillWaTemplate(tpl.template, tpl.waVariables, vars);
    const missing = (tpl.waVariables ?? []).filter((k) => !vars[k]).map((k) => VAR_LABEL[k] ?? k);
    return { ok: true, message: text, missing, mobile: farmer?.mobile ?? null, templateName: tpl.name, waReady: waConfig().ready, hasTemplate: !!tpl.waTemplateName };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not prepare the message." };
  }
}

/** Send the WhatsApp message via the Cloud API, log it, and mark the member reached-by-WhatsApp on success. */
export async function sendCampaignWhatsApp(input: { memberId: number; commTemplateId?: number | null; message: string }): Promise<{ ok: boolean; error?: string; providerId?: string }> {
  if (!(await requireManager()).ok) return { ok: false, error: "WhatsApp is available to admins only." };
  const scope = await memberScopeWhere();
  if (scope === "none") return { ok: false, error: "Not authorised." };
  const message = (input.message ?? "").trim();
  if (!message) return { ok: false, error: "Message is empty." };
  try {
    const member = await prisma.campaignMember.findFirst({
      where: { id: input.memberId, ...(scope ?? {}) },
      select: { id: true, farmerId: true, campaignId: true, mediums: true, campaign: { select: { endDate: true } } },
    });
    if (!member) return { ok: false, error: "Member not found or out of your scope." };
    const farmer = await prisma.farmer.findUnique({ where: { id: member.farmerId }, select: { name: true, mobile: true, hniGap: true, village: true, crop: true, cropTags: true, store: { select: { name: true } } } });
    const mobile = farmer?.mobile ?? "";
    if (!mobile) return { ok: false, error: "No phone number on file for this farmer." };

    const tpl = input.commTemplateId
      ? await prisma.commTemplate.findUnique({ where: { id: input.commTemplateId }, select: { waTemplateName: true, waLanguage: true, waVariables: true } })
      : null;
    const useTemplate = !!tpl?.waTemplateName;
    // Template sends need one param per {{n}}, in the comm plan's mapped order — not the whole message text.
    const src: FarmerVarSource = { name: farmer?.name ?? null, mobile: farmer?.mobile ?? null, village: farmer?.village ?? null, hniGap: farmer?.hniGap ?? null, cropTags: farmer?.cropTags ?? [], crop: farmer?.crop ?? null, storeName: farmer?.store?.name ?? null };
    const vars = resolveVars(src, member.campaign?.endDate ?? null);

    const actor = await getActor();
    const res = await sendWhatsApp({
      mobile, message,
      templateName: useTemplate ? tpl!.waTemplateName : null,
      languageCode: tpl?.waLanguage ?? null,
      bodyParams: useTemplate ? positionalParams(tpl!.waVariables, vars) : undefined,
    });

    await prisma.whatsAppLog.create({
      data: {
        farmerId: member.farmerId, campaignId: member.campaignId, memberId: member.id, mobile,
        kind: useTemplate ? "template" : "text", templateName: useTemplate ? tpl!.waTemplateName : null, message,
        ok: res.ok, providerId: res.providerId ?? null, status: res.status ?? null, error: res.error ?? null,
        sentByName: actor.name, sentByCode: actor.code,
      },
    });

    if (res.ok) {
      const mediums = member.mediums.includes("WHATSAPP") ? member.mediums : [...member.mediums.filter((m) => m !== "UNREACHABLE"), "WHATSAPP"];
      await prisma.campaignMember.update({
        where: { id: member.id },
        data: { reached: true, reachedAt: new Date(), mediums, reachedBy: actor.name, reachedByCode: actor.code },
      });
      await logAudit("WhatsApp", "SEND", `Sent campaign WhatsApp ${useTemplate ? "template" : "message"} to ${mobile}`, actor.name);
      revalidatePath("/campaigns");
    }
    return { ok: res.ok, error: res.error, providerId: res.providerId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Send failed." };
  }
}
