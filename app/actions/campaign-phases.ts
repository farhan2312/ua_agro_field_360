"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getScope, canManage, getActor } from "@/lib/scope";
import { shortStoreName } from "@/lib/store-utils";
import {
  subCohortsFor, subCohortOf, valueBand, asCoupons, asCommConfig,
  type Coupon, type CommConfig, type MemberStatus,
} from "@/lib/campaign-phases";

const iso = (d: Date) => d.toISOString().slice(0, 10);
async function isManager(): Promise<boolean> { const { role } = await getScope(); return canManage(role); }

/* ─────────────────── shared: the stores present in a campaign ─────────────────── */

async function storesOfCampaign(campaignId: number): Promise<{ id: number; name: string }[]> {
  const rows = await prisma.campaignMember.findMany({
    where: { campaignId, storeId: { not: null } }, select: { storeId: true }, distinct: ["storeId"],
  });
  const ids = rows.map((r) => r.storeId!).filter((x): x is number => x != null);
  if (!ids.length) return [];
  const stores = await prisma.store.findMany({ where: { id: { in: ids } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return stores.map((s) => ({ id: s.id, name: shortStoreName(s.name) || s.name }));
}

/* ─────────────────────────── M2 — phase definition ─────────────────────────── */

export interface PhaseWindowVM { storeId: number; start: string; end: string }
export interface PhaseVM {
  id: number; ordinal: number; name: string; type: string;
  defaultStart: string; defaultEnd: string;
  coupons: Coupon[]; commConfig: CommConfig; windows: PhaseWindowVM[];
}
export interface CampaignPhaseConfig {
  campaignId: number; campaignName: string; campaignStart: string; campaignEnd: string;
  fertiliserCategories: string[]; comboCategories: string[];
  phases: PhaseVM[]; stores: { id: number; name: string }[]; canManage: boolean;
}

export async function getCampaignPhaseConfig(campaignId: number): Promise<CampaignPhaseConfig | null> {
  const camp = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { phases: { orderBy: { ordinal: "asc" }, include: { windows: true } } },
  });
  if (!camp) return null;
  const stores = await storesOfCampaign(campaignId);
  return {
    campaignId: camp.id, campaignName: camp.name,
    campaignStart: iso(camp.startDate), campaignEnd: iso(camp.endDate),
    fertiliserCategories: camp.fertiliserCategories, comboCategories: camp.comboCategories,
    stores, canManage: await isManager(),
    phases: camp.phases.map((p) => ({
      id: p.id, ordinal: p.ordinal, name: p.name, type: p.type,
      defaultStart: iso(p.defaultStart), defaultEnd: iso(p.defaultEnd),
      coupons: asCoupons(p.coupons), commConfig: asCommConfig(p.commConfig),
      windows: p.windows.map((w) => ({ storeId: w.storeId, start: iso(w.start), end: iso(w.end) })),
    })),
  };
}

export interface PhaseInput {
  ordinal: number; name: string; type: string;
  defaultStart: string; defaultEnd: string;
  coupons?: Coupon[]; commConfig?: CommConfig; windows?: PhaseWindowVM[];
}

/** Full-replace the phase definition of a campaign (manager only). Validates windows ⊆ campaign window. */
export async function saveCampaignPhases(campaignId: number, phases: PhaseInput[]): Promise<{ ok: boolean; error?: string }> {
  if (!(await isManager())) return { ok: false, error: "Only the central team can edit phases." };
  const camp = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { startDate: true, endDate: true } });
  if (!camp) return { ok: false, error: "Campaign not found." };
  const cs = camp.startDate, ce = camp.endDate;

  const cleaned = [...phases].sort((a, b) => a.ordinal - b.ordinal);
  if (!cleaned.length) return { ok: false, error: "A campaign needs at least one phase." };

  // Validate each phase window sits inside the campaign window, and ordinals are unique.
  const seen = new Set<number>();
  for (const p of cleaned) {
    if (seen.has(p.ordinal)) return { ok: false, error: `Duplicate phase number ${p.ordinal}.` };
    seen.add(p.ordinal);
    if (!p.name.trim()) return { ok: false, error: "Every phase needs a name." };
    const s = new Date(`${p.defaultStart}T00:00:00`), e = new Date(`${p.defaultEnd}T00:00:00`);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return { ok: false, error: `Set valid dates for "${p.name}".` };
    if (s > e) return { ok: false, error: `"${p.name}" ends before it starts.` };
    if (s < cs || e > ce) return { ok: false, error: `"${p.name}" must sit within the campaign window (${iso(cs)} – ${iso(ce)}).` };
    for (const w of p.windows ?? []) {
      const ws = new Date(`${w.start}T00:00:00`), we = new Date(`${w.end}T00:00:00`);
      if (Number.isNaN(ws.getTime()) || Number.isNaN(we.getTime()) || ws > we) return { ok: false, error: `Bad store override dates in "${p.name}".` };
      if (ws < cs || we > ce) return { ok: false, error: `A store override in "${p.name}" falls outside the campaign window.` };
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.campaignPhase.deleteMany({ where: { campaignId } }); // cascades windows
      for (const p of cleaned) {
        await tx.campaignPhase.create({
          data: {
            campaignId, ordinal: p.ordinal, name: p.name.trim(), type: p.type,
            defaultStart: new Date(`${p.defaultStart}T00:00:00`), defaultEnd: new Date(`${p.defaultEnd}T00:00:00`),
            coupons: (p.coupons ?? []) as unknown as Prisma.InputJsonValue,
            commConfig: (p.commConfig ?? {}) as unknown as Prisma.InputJsonValue,
            windows: { create: (p.windows ?? []).map((w) => ({ storeId: w.storeId, start: new Date(`${w.start}T00:00:00`), end: new Date(`${w.end}T00:00:00`) })) },
          },
        });
      }
      // Clamp any per-store cursor that now points past the last ordinal.
      const maxOrd = Math.max(...cleaned.map((p) => p.ordinal));
      await tx.campaignStoreState.updateMany({ where: { campaignId, currentOrdinal: { gt: maxOrd } }, data: { currentOrdinal: maxOrd } });
    });
    revalidatePath("/campaigns");
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Save failed." }; }
}

export async function setCampaignCategories(campaignId: number, fertiliserCategories: string[], comboCategories: string[]): Promise<{ ok: boolean; error?: string }> {
  if (!(await isManager())) return { ok: false, error: "Only the central team can edit this." };
  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      fertiliserCategories: [...new Set(fertiliserCategories.map((s) => s.trim()).filter(Boolean))],
      comboCategories: [...new Set(comboCategories.map((s) => s.trim()).filter(Boolean))],
    },
  });
  revalidatePath("/campaigns");
  return { ok: true };
}

/** Distinct product categories seen in real sales (for the fertiliser/combo category pickers). */
export async function getProductCategoryOptions(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ c: string }[]>(
    `SELECT DISTINCT "mainCategory" c FROM "SaleLine" WHERE source='REAL' AND "mainCategory" IS NOT NULL AND "mainCategory" <> '' ORDER BY 1`,
  );
  return rows.map((r) => r.c);
}

/* ─────────────────────────── M3 — status engine ─────────────────────────── */

/**
 * Recompute member purchase flags from sales (manager only). Sales are the source of truth but NEVER
 * clobber an OFFICER override. Fertiliser/combo are matched by product category (mainCategory OR
 * subCategory) within the campaign window; coupon matching is best-effort where a coupon code appears.
 * `booked` is not sales-derivable (a deposit isn't a sale) — it stays officer-marked.
 */
export async function recomputeCampaignStatuses(campaignId: number): Promise<{ ok: boolean; fertiliser?: number; combo?: number; error?: string }> {
  if (!(await isManager())) return { ok: false, error: "Only the central team can run this." };
  const camp = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { phases: { select: { defaultStart: true, defaultEnd: true } } },
  });
  if (!camp) return { ok: false, error: "Campaign not found." };
  const fertCats = camp.fertiliserCategories, comboCats = camp.comboCategories;
  if (!fertCats.length && !comboCats.length) return { ok: false, error: "Set the fertiliser / combo product categories first (Categories tab)." };

  // Bound the scan to the campaign window (or the phase span if wider).
  const starts = [camp.startDate, ...camp.phases.map((p) => p.defaultStart)];
  const ends = [camp.endDate, ...camp.phases.map((p) => p.defaultEnd)];
  const from = new Date(Math.min(...starts.map((d) => d.getTime())));
  const to = new Date(Math.max(...ends.map((d) => d.getTime())) + 24 * 3600 * 1000); // inclusive of end day

  const members = await prisma.campaignMember.findMany({
    where: { campaignId, farmerId: { not: undefined } },
    select: { id: true, farmerId: true, fertiliserSource: true, comboSource: true },
  });
  const farmerIds = [...new Set(members.map((m) => m.farmerId))];
  if (!farmerIds.length) return { ok: true, fertiliser: 0, combo: 0 };

  // Which farmers bought a fertiliser-category / combo-category line in-window?
  const catMatch = async (cats: string[]): Promise<Set<number>> => {
    if (!cats.length) return new Set();
    const lines = await prisma.saleLine.findMany({
      where: {
        farmerId: { in: farmerIds }, source: "REAL", soldAt: { gte: from, lt: to },
        OR: [{ mainCategory: { in: cats } }, { subCategory: { in: cats } }],
      },
      select: { farmerId: true }, distinct: ["farmerId"],
    });
    return new Set(lines.map((l) => l.farmerId!).filter((x): x is number => x != null));
  };
  const [fertFarmers, comboFarmers] = await Promise.all([catMatch(fertCats), catMatch(comboCats)]);

  const now = new Date();
  let fertN = 0, comboN = 0;
  // Upgrade-only: set true where matched and not officer-overridden. Never downgrade.
  const fertIds = members.filter((m) => m.fertiliserSource !== "OFFICER" && fertFarmers.has(m.farmerId)).map((m) => m.id);
  const comboIds = members.filter((m) => m.comboSource !== "OFFICER" && comboFarmers.has(m.farmerId)).map((m) => m.id);
  if (fertIds.length) { const r = await prisma.campaignMember.updateMany({ where: { id: { in: fertIds } }, data: { boughtFertiliser: true, fertiliserSource: "SALES", fertiliserAt: now } }); fertN = r.count; }
  if (comboIds.length) { const r = await prisma.campaignMember.updateMany({ where: { id: { in: comboIds } }, data: { boughtCombo: true, comboSource: "SALES", comboAt: now } }); comboN = r.count; }

  revalidatePath("/campaigns");
  return { ok: true, fertiliser: fertN, combo: comboN };
}

/** Officer/RM/manager override of a member's purchase flags (source = OFFICER; protected from recompute). */
export async function setMemberStatusOverride(
  memberId: number,
  patch: { booked?: boolean; boughtFertiliser?: boolean; boughtCombo?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  const { role, storeId, zone } = await getScope();
  const m = await prisma.campaignMember.findUnique({ where: { id: memberId }, select: { storeId: true, zone: true } });
  if (!m) return { ok: false, error: "Member not found." };
  // Scope: officers only their store, RMs only their zone; managers anywhere.
  if (role === "officer" && (storeId == null || m.storeId !== storeId)) return { ok: false, error: "Out of your store." };
  if (role === "regional" && (zone == null || m.zone !== zone)) return { ok: false, error: "Out of your region." };

  const now = new Date();
  const data: Prisma.CampaignMemberUpdateInput = {};
  if (patch.booked !== undefined) { data.booked = patch.booked; data.bookedSource = "OFFICER"; data.bookedAt = now; }
  if (patch.boughtFertiliser !== undefined) { data.boughtFertiliser = patch.boughtFertiliser; data.fertiliserSource = "OFFICER"; data.fertiliserAt = now; }
  if (patch.boughtCombo !== undefined) { data.boughtCombo = patch.boughtCombo; data.comboSource = "OFFICER"; data.comboAt = now; }
  if (Object.keys(data).length === 0) return { ok: true };
  await prisma.campaignMember.update({ where: { id: memberId }, data });
  revalidatePath("/campaigns");
  return { ok: true };
}

/* ─────────────────────────── M4 — per-store advancement ─────────────────────────── */

export interface StorePhaseRow {
  storeId: number; storeName: string;
  currentOrdinal: number; phaseName: string; phaseType: string;
  windowStart: string | null; windowEnd: string | null;
  memberCount: number; // TEST members at this store
  cohorts: { key: string; label: string; goal: string; count: number }[];
  hasNext: boolean; nextPhaseName: string | null;
  advancedByName: string | null; advancedAt: string | null;
}
export interface PhaseBoard {
  campaignId: number; phases: { ordinal: number; name: string; type: string }[];
  rows: StorePhaseRow[]; canManage: boolean;
}

/** Per-store phase board — scoped (officer→own store, RM→own zone, manager→all). */
export async function getPhaseBoard(campaignId: number): Promise<PhaseBoard | null> {
  const { role, storeId, zone } = await getScope();
  const camp = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { phases: { orderBy: { ordinal: "asc" }, include: { windows: true } } },
  });
  if (!camp || camp.phases.length === 0) return null;
  const maxOrd = Math.max(...camp.phases.map((p) => p.ordinal));
  const phaseByOrd = new Map(camp.phases.map((p) => [p.ordinal, p]));

  // Scope the member set.
  const memWhere: Prisma.CampaignMemberWhereInput = { campaignId, group: "TEST" };
  if (role === "officer") { if (storeId == null) return { campaignId, phases: [], rows: [], canManage: false }; memWhere.storeId = storeId; }
  else if (role === "regional") { if (zone == null) return { campaignId, phases: [], rows: [], canManage: false }; memWhere.zone = zone; }

  const members = await prisma.campaignMember.findMany({
    where: memWhere,
    select: { storeId: true, valueSegment: true, booked: true, boughtFertiliser: true, boughtCombo: true },
  });
  const states = await prisma.campaignStoreState.findMany({ where: { campaignId } });
  const stateByStore = new Map(states.map((s) => [s.storeId, s]));

  // Group members by store.
  const byStore = new Map<number, typeof members>();
  for (const m of members) {
    if (m.storeId == null) continue;
    const arr = byStore.get(m.storeId) ?? [];
    arr.push(m); byStore.set(m.storeId, arr);
  }
  const storeIds = [...byStore.keys()];
  const storeRows = storeIds.length ? await prisma.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, name: true } }) : [];
  const nameById = new Map(storeRows.map((s) => [s.id, shortStoreName(s.name) || s.name]));

  const rows: StorePhaseRow[] = storeIds.map((sid) => {
    const st = stateByStore.get(sid);
    const ord = st?.currentOrdinal ?? 1;
    const phase = phaseByOrd.get(ord) ?? camp.phases[0];
    const win = phase.windows.find((w) => w.storeId === sid);
    const defs = subCohortsFor(phase.type);
    const mem = byStore.get(sid)!;
    const counts = new Map<string, number>();
    for (const m of mem) {
      const key = subCohortOf(phase.type, { booked: m.booked, boughtFertiliser: m.boughtFertiliser, boughtCombo: m.boughtCombo });
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return {
      storeId: sid, storeName: nameById.get(sid) ?? `#${sid}`,
      currentOrdinal: ord, phaseName: phase.name, phaseType: phase.type,
      windowStart: iso(win?.start ?? phase.defaultStart), windowEnd: iso(win?.end ?? phase.defaultEnd),
      memberCount: mem.length,
      cohorts: defs.map((d) => ({ key: d.key, label: d.label, goal: d.goal, count: counts.get(d.key) ?? 0 })),
      hasNext: ord < maxOrd, nextPhaseName: ord < maxOrd ? (phaseByOrd.get(ord + 1)?.name ?? null) : null,
      advancedByName: st?.advancedByName ?? null, advancedAt: st?.advancedAt ? iso(st.advancedAt) : null,
    };
  }).sort((a, b) => a.storeName.localeCompare(b.storeName));

  return {
    campaignId, canManage: canManage(role),
    phases: camp.phases.map((p) => ({ ordinal: p.ordinal, name: p.name, type: p.type })),
    rows,
  };
}

/** Advance one store to the next phase (manager only). Requires the sales-data attestation tick. */
export async function advanceStorePhase(input: { campaignId: number; storeId: number; attested: boolean; note?: string }): Promise<{ ok: boolean; error?: string }> {
  if (!(await isManager())) return { ok: false, error: "Only the central team can advance phases." };
  if (!input.attested) return { ok: false, error: "Confirm the phase's sales data is uploaded before advancing." };
  const camp = await prisma.campaign.findUnique({ where: { id: input.campaignId }, include: { phases: { select: { ordinal: true } } } });
  if (!camp || !camp.phases.length) return { ok: false, error: "Campaign has no phases." };
  const maxOrd = Math.max(...camp.phases.map((p) => p.ordinal));

  const st = await prisma.campaignStoreState.findUnique({ where: { campaignId_storeId: { campaignId: input.campaignId, storeId: input.storeId } } });
  const current = st?.currentOrdinal ?? 1;
  if (current >= maxOrd) return { ok: false, error: "This store is already in the final phase." };
  const next = current + 1;

  const actor = await getActor();
  await prisma.$transaction([
    prisma.campaignStoreState.upsert({
      where: { campaignId_storeId: { campaignId: input.campaignId, storeId: input.storeId } },
      update: { currentOrdinal: next, advancedAt: new Date(), advancedByName: actor.name, advancedByCode: actor.code },
      create: { campaignId: input.campaignId, storeId: input.storeId, currentOrdinal: next, advancedByName: actor.name, advancedByCode: actor.code },
    }),
    prisma.campaignPhaseAdvance.create({
      data: { campaignId: input.campaignId, storeId: input.storeId, fromOrdinal: current, toOrdinal: next, attestationNote: input.note?.trim() || null, byName: actor.name, byCode: actor.code },
    }),
  ]);
  revalidatePath("/campaigns");
  return { ok: true };
}

export interface AdvanceLogVM { fromOrdinal: number; toOrdinal: number; note: string | null; by: string | null; at: string }
export async function getStoreAdvanceHistory(campaignId: number, storeId: number): Promise<AdvanceLogVM[]> {
  const rows = await prisma.campaignPhaseAdvance.findMany({ where: { campaignId, storeId }, orderBy: { createdAt: "desc" } });
  return rows.map((r) => ({ fromOrdinal: r.fromOrdinal, toOrdinal: r.toOrdinal, note: r.attestationNote, by: r.byName, at: r.createdAt.toISOString() }));
}

/* ─────────────────────────── M6 — phase funnel / reporting ─────────────────────────── */

export interface PhaseFunnel {
  totalTest: number;
  booked: number; boughtFertiliser: number; boughtCombo: number;
  buckets: { key: string; label: string; count: number }[]; // the consumer-journey outcome paths
  reached: number; // test members with a logged contact outcome
  contactTouches: number; // total mediums logged across the test group (≈ "no. of contacts")
}

/** Outcome funnel across the TEST group (scoped). Mirrors the email's contact-path buckets. */
export async function getPhaseFunnel(campaignId: number): Promise<PhaseFunnel | null> {
  const { role, storeId, zone } = await getScope();
  const where: Prisma.CampaignMemberWhereInput = { campaignId, group: "TEST" };
  if (role === "officer") { if (storeId == null) return null; where.storeId = storeId; }
  else if (role === "regional") { if (zone == null) return null; where.zone = zone; }

  const rows = await prisma.campaignMember.findMany({
    where, select: { booked: true, boughtFertiliser: true, boughtCombo: true, reached: true, mediums: true },
  });
  const f = { bookedCombo: 0, bookedNoCombo: 0, notBookedFertCombo: 0, notBookedFertNoCombo: 0, noPurchase: 0, other: 0 };
  let booked = 0, fert = 0, combo = 0, reached = 0, touches = 0;
  for (const r of rows) {
    if (r.booked) booked++; if (r.boughtFertiliser) fert++; if (r.boughtCombo) combo++;
    if (r.reached) reached++;
    touches += r.mediums.filter((m) => m !== "UNREACHABLE").length;
    if (r.booked && r.boughtCombo) f.bookedCombo++;
    else if (r.booked && !r.boughtCombo) f.bookedNoCombo++;
    else if (!r.booked && r.boughtFertiliser && r.boughtCombo) f.notBookedFertCombo++;
    else if (!r.booked && r.boughtFertiliser && !r.boughtCombo) f.notBookedFertNoCombo++;
    else if (!r.booked && !r.boughtFertiliser && !r.boughtCombo) f.noPurchase++;
    else f.other++;
  }
  return {
    totalTest: rows.length, booked, boughtFertiliser: fert, boughtCombo: combo, reached, contactTouches: touches,
    buckets: [
      { key: "bookedCombo", label: "Booked + combo", count: f.bookedCombo },
      { key: "bookedNoCombo", label: "Booked, no combo", count: f.bookedNoCombo },
      { key: "notBookedFertCombo", label: "No booking · fertiliser + combo", count: f.notBookedFertCombo },
      { key: "notBookedFertNoCombo", label: "No booking · fertiliser, no combo", count: f.notBookedFertNoCombo },
      { key: "noPurchase", label: "No purchase", count: f.noPurchase },
      ...(f.other ? [{ key: "other", label: "Other", count: f.other }] : []),
    ],
  };
}

/* ─────────────────────────── M5 — phase-aware outreach ─────────────────────────── */

export interface PhaseOutreachMember {
  memberId: number; farmerId: number; name: string; mobile: string | null; village: string | null; store: string | null;
  valueBand: "HNI" | "OTHERS"; cohort: string; cohortLabel: string;
  booked: boolean; boughtFertiliser: boolean; boughtCombo: boolean;
  reached: boolean; mediums: string[];
  recCommPlan: string | null; recChannel: string | null; // recommended message + channel for this cohort×band
}
export interface PhaseOutreach {
  campaignId: number; storeId: number; storeName: string;
  ordinal: number; phaseName: string; phaseType: string;
  coupons: Coupon[];
  members: PhaseOutreachMember[];
}

/**
 * The current phase's contact list for ONE store, routed by cohort × value band with the recommended
 * comm plan + channel. Scoped: officers/RMs only their own store(s); managers may pass any store.
 */
export async function getPhaseOutreach(campaignId: number, storeId: number): Promise<PhaseOutreach | null> {
  const { role, storeId: myStore, zone } = await getScope();
  if (role === "officer" && (myStore == null || storeId !== myStore)) return null;
  const camp = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { phases: { orderBy: { ordinal: "asc" }, include: { windows: true } } },
  });
  if (!camp || !camp.phases.length) return null;

  const st = await prisma.campaignStoreState.findUnique({ where: { campaignId_storeId: { campaignId, storeId } } });
  const ord = st?.currentOrdinal ?? 1;
  const phase = camp.phases.find((p) => p.ordinal === ord) ?? camp.phases[0];
  const commConfig = asCommConfig(phase.commConfig);

  const where: Prisma.CampaignMemberWhereInput = { campaignId, group: "TEST", storeId };
  if (role === "regional") { if (zone == null) return null; where.zone = zone; }
  const members = await prisma.campaignMember.findMany({ where, orderBy: { id: "asc" } });
  const farmerIds = members.map((m) => m.farmerId);
  const farmers = new Map((await prisma.farmer.findMany({ where: { id: { in: farmerIds } }, select: { id: true, name: true, mobile: true, village: true } })).map((f) => [f.id, f]));
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { name: true } });

  const out: PhaseOutreachMember[] = [];
  for (const m of members) {
    const status: MemberStatus = { booked: m.booked, boughtFertiliser: m.boughtFertiliser, boughtCombo: m.boughtCombo };
    const cohort = subCohortOf(phase.type, status);
    if (!cohort) continue; // converted / done — not contacted this phase
    const band = valueBand(m.valueSegment);
    const slot = commConfig[cohort]?.[band] ?? {};
    const f = farmers.get(m.farmerId);
    const cohortLabel = subCohortsFor(phase.type).find((d) => d.key === cohort)?.label ?? cohort;
    out.push({
      memberId: m.id, farmerId: m.farmerId, name: f?.name ?? "Unknown", mobile: f?.mobile ?? null, village: f?.village ?? null,
      store: shortStoreName(store?.name) || store?.name || null,
      valueBand: band, cohort, cohortLabel,
      booked: m.booked, boughtFertiliser: m.boughtFertiliser, boughtCombo: m.boughtCombo,
      reached: m.reached, mediums: m.mediums,
      recCommPlan: slot.commPlan ?? null, recChannel: slot.channel ?? null,
    });
  }
  return {
    campaignId, storeId, storeName: shortStoreName(store?.name) || store?.name || `#${storeId}`,
    ordinal: ord, phaseName: phase.name, phaseType: phase.type,
    coupons: asCoupons(phase.coupons), members: out,
  };
}
