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

/* ─────────────────────────── Round definition ─────────────────────────── */
// A "round" is one unit for the WHOLE campaign — no per-store dates/coupons. Store-level differences are
// handled by scoping clusters/campaigns. (The DB model is still named CampaignPhase for continuity.)

export interface PhaseVM {
  id: number; ordinal: number; name: string; type: string;
  defaultStart: string; defaultEnd: string;
  coupons: Coupon[]; commConfig: CommConfig;
}
export interface CampaignPhaseConfig {
  campaignId: number; campaignName: string; campaignStart: string; campaignEnd: string;
  fertiliserCategories: string[]; comboCategories: string[];
  currentRound: number; phases: PhaseVM[]; canManage: boolean;
}

export async function getCampaignPhaseConfig(campaignId: number): Promise<CampaignPhaseConfig | null> {
  const camp = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { phases: { orderBy: { ordinal: "asc" } } },
  });
  if (!camp) return null;
  return {
    campaignId: camp.id, campaignName: camp.name,
    campaignStart: iso(camp.startDate), campaignEnd: iso(camp.endDate),
    fertiliserCategories: camp.fertiliserCategories, comboCategories: camp.comboCategories,
    currentRound: camp.currentRound, canManage: await isManager(),
    phases: camp.phases.map((p) => ({
      id: p.id, ordinal: p.ordinal, name: p.name, type: p.type,
      defaultStart: iso(p.defaultStart), defaultEnd: iso(p.defaultEnd),
      coupons: asCoupons(p.coupons), commConfig: asCommConfig(p.commConfig),
    })),
  };
}

export interface PhaseInput {
  ordinal: number; name: string; type: string;
  defaultStart: string; defaultEnd: string;
  coupons?: Coupon[]; commConfig?: CommConfig;
}

/** Full-replace the round definition of a campaign (manager only). Validates each round ⊆ campaign window. */
export async function saveCampaignPhases(campaignId: number, phases: PhaseInput[]): Promise<{ ok: boolean; error?: string }> {
  if (!(await isManager())) return { ok: false, error: "Only the central team can edit rounds." };
  const camp = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { startDate: true, endDate: true, currentRound: true } });
  if (!camp) return { ok: false, error: "Campaign not found." };
  const cs = camp.startDate, ce = camp.endDate;

  const cleaned = [...phases].sort((a, b) => a.ordinal - b.ordinal);
  if (!cleaned.length) return { ok: false, error: "A campaign needs at least one round." };

  const seen = new Set<number>();
  for (const p of cleaned) {
    if (seen.has(p.ordinal)) return { ok: false, error: `Duplicate round number ${p.ordinal}.` };
    seen.add(p.ordinal);
    if (!p.name.trim()) return { ok: false, error: "Every round needs a name." };
    const s = new Date(`${p.defaultStart}T00:00:00`), e = new Date(`${p.defaultEnd}T00:00:00`);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return { ok: false, error: `Set valid dates for "${p.name}".` };
    if (s > e) return { ok: false, error: `"${p.name}" ends before it starts.` };
    if (s < cs || e > ce) return { ok: false, error: `"${p.name}" must sit within the campaign window (${iso(cs)} – ${iso(ce)}).` };
  }

  try {
    const maxOrd = Math.max(...cleaned.map((p) => p.ordinal));
    await prisma.$transaction(async (tx) => {
      await tx.campaignPhase.deleteMany({ where: { campaignId } });
      for (const p of cleaned) {
        await tx.campaignPhase.create({
          data: {
            campaignId, ordinal: p.ordinal, name: p.name.trim(), type: p.type,
            defaultStart: new Date(`${p.defaultStart}T00:00:00`), defaultEnd: new Date(`${p.defaultEnd}T00:00:00`),
            coupons: (p.coupons ?? []) as unknown as Prisma.InputJsonValue,
            commConfig: (p.commConfig ?? {}) as unknown as Prisma.InputJsonValue,
          },
        });
      }
      // Keep the campaign's current round within the new round range.
      if (camp.currentRound > maxOrd) await tx.campaign.update({ where: { id: campaignId }, data: { currentRound: maxOrd } });
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

/* ─────────────────────────── Status engine ─────────────────────────── */

/**
 * Recompute member purchase flags from sales (manager only). Sales are the source of truth but NEVER
 * clobber an OFFICER override. Fertiliser/combo are matched by product category (mainCategory OR
 * subCategory) within the campaign window. `booked` is not sales-derivable — it stays officer-marked.
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

  const starts = [camp.startDate, ...camp.phases.map((p) => p.defaultStart)];
  const ends = [camp.endDate, ...camp.phases.map((p) => p.defaultEnd)];
  const from = new Date(Math.min(...starts.map((d) => d.getTime())));
  const to = new Date(Math.max(...ends.map((d) => d.getTime())) + 24 * 3600 * 1000);

  const members = await prisma.campaignMember.findMany({
    where: { campaignId, farmerId: { not: undefined } },
    select: { id: true, farmerId: true, fertiliserSource: true, comboSource: true },
  });
  const farmerIds = [...new Set(members.map((m) => m.farmerId))];
  if (!farmerIds.length) return { ok: true, fertiliser: 0, combo: 0 };

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

/* ─────────────────────────── Round status + advancement (campaign-wide) ─────────────────────────── */

export interface RoundCohort { key: string; label: string; goal: string; count: number }
export interface RoundStatus {
  campaignId: number;
  rounds: { ordinal: number; name: string; type: string }[];
  currentOrdinal: number; roundName: string; roundType: string;
  windowStart: string; windowEnd: string;
  memberCount: number; // scoped TEST members
  cohorts: RoundCohort[];
  hasNext: boolean; nextRoundName: string | null;
  advancedByName: string | null; advancedAt: string | null;
  canManage: boolean;
}

/** Campaign-wide round status + this round's cohort counts (scoped to the caller's farmers). */
export async function getRoundStatus(campaignId: number): Promise<RoundStatus | null> {
  const { role, storeId, zone } = await getScope();
  const camp = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { phases: { orderBy: { ordinal: "asc" } } },
  });
  if (!camp || camp.phases.length === 0) return null;
  const maxOrd = Math.max(...camp.phases.map((p) => p.ordinal));
  const ord = Math.min(camp.currentRound, maxOrd);
  const round = camp.phases.find((p) => p.ordinal === ord) ?? camp.phases[0];

  const where: Prisma.CampaignMemberWhereInput = { campaignId, group: "TEST" };
  if (role === "officer") { if (storeId == null) return { ...emptyStatus(campaignId, camp.phases, round, ord, maxOrd, canManage(role)) }; where.storeId = storeId; }
  else if (role === "regional") { if (zone == null) return { ...emptyStatus(campaignId, camp.phases, round, ord, maxOrd, canManage(role)) }; where.zone = zone; }

  const members = await prisma.campaignMember.findMany({ where, select: { booked: true, boughtFertiliser: true, boughtCombo: true } });
  const defs = subCohortsFor(round.type);
  const counts = new Map<string, number>();
  for (const m of members) {
    const key = subCohortOf(round.type, { booked: m.booked, boughtFertiliser: m.boughtFertiliser, boughtCombo: m.boughtCombo });
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const lastAdvance = await prisma.campaignPhaseAdvance.findFirst({ where: { campaignId }, orderBy: { createdAt: "desc" } });

  return {
    campaignId,
    rounds: camp.phases.map((p) => ({ ordinal: p.ordinal, name: p.name, type: p.type })),
    currentOrdinal: ord, roundName: round.name, roundType: round.type,
    windowStart: iso(round.defaultStart), windowEnd: iso(round.defaultEnd),
    memberCount: members.length,
    cohorts: defs.map((d) => ({ key: d.key, label: d.label, goal: d.goal, count: counts.get(d.key) ?? 0 })),
    hasNext: ord < maxOrd, nextRoundName: ord < maxOrd ? (camp.phases.find((p) => p.ordinal === ord + 1)?.name ?? null) : null,
    advancedByName: lastAdvance?.byName ?? null, advancedAt: lastAdvance ? iso(lastAdvance.createdAt) : null,
    canManage: canManage(role),
  };
}

function emptyStatus(campaignId: number, phases: { ordinal: number; name: string; type: string; defaultStart: Date; defaultEnd: Date }[], round: { name: string; type: string; defaultStart: Date; defaultEnd: Date }, ord: number, maxOrd: number, mgr: boolean): RoundStatus {
  return {
    campaignId, rounds: phases.map((p) => ({ ordinal: p.ordinal, name: p.name, type: p.type })),
    currentOrdinal: ord, roundName: round.name, roundType: round.type,
    windowStart: iso(round.defaultStart), windowEnd: iso(round.defaultEnd),
    memberCount: 0, cohorts: subCohortsFor(round.type).map((d) => ({ key: d.key, label: d.label, goal: d.goal, count: 0 })),
    hasNext: ord < maxOrd, nextRoundName: null, advancedByName: null, advancedAt: null, canManage: mgr,
  };
}

/** Advance the WHOLE campaign to the next round (manager only). Requires the sales-data attestation tick. */
export async function advanceCampaignRound(input: { campaignId: number; attested: boolean; note?: string }): Promise<{ ok: boolean; error?: string }> {
  if (!(await isManager())) return { ok: false, error: "Only the central team can advance rounds." };
  if (!input.attested) return { ok: false, error: "Confirm the round's sales data is uploaded before advancing." };
  const camp = await prisma.campaign.findUnique({ where: { id: input.campaignId }, include: { phases: { select: { ordinal: true } } } });
  if (!camp || !camp.phases.length) return { ok: false, error: "Campaign has no rounds." };
  const maxOrd = Math.max(...camp.phases.map((p) => p.ordinal));
  const current = Math.min(camp.currentRound, maxOrd);
  if (current >= maxOrd) return { ok: false, error: "The campaign is already in its final round." };
  const next = current + 1;

  const actor = await getActor();
  await prisma.$transaction([
    prisma.campaign.update({ where: { id: input.campaignId }, data: { currentRound: next } }),
    prisma.campaignPhaseAdvance.create({
      data: { campaignId: input.campaignId, fromOrdinal: current, toOrdinal: next, attestationNote: input.note?.trim() || null, byName: actor.name, byCode: actor.code },
    }),
  ]);
  revalidatePath("/campaigns");
  return { ok: true };
}

export interface AdvanceLogVM { fromOrdinal: number; toOrdinal: number; note: string | null; by: string | null; at: string }
export async function getRoundAdvanceHistory(campaignId: number): Promise<AdvanceLogVM[]> {
  const rows = await prisma.campaignPhaseAdvance.findMany({ where: { campaignId }, orderBy: { createdAt: "desc" } });
  return rows.map((r) => ({ fromOrdinal: r.fromOrdinal, toOrdinal: r.toOrdinal, note: r.attestationNote, by: r.byName, at: r.createdAt.toISOString() }));
}

/* ─────────────────────────── Funnel / reporting ─────────────────────────── */

export interface PhaseFunnel {
  totalTest: number;
  booked: number; boughtFertiliser: number; boughtCombo: number;
  buckets: { key: string; label: string; count: number }[];
  reached: number; contactTouches: number;
}

/** Outcome funnel across the TEST group (scoped). */
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

/* ─────────────────────────── Round-aware outreach (scoped, campaign-wide) ─────────────────────────── */

export interface PhaseOutreachMember {
  memberId: number; farmerId: number; name: string; mobile: string | null; village: string | null; store: string | null;
  valueBand: "HNI" | "OTHERS"; cohort: string; cohortLabel: string;
  booked: boolean; boughtFertiliser: boolean; boughtCombo: boolean;
  reached: boolean; mediums: string[];
  recCommPlan: string | null; recChannel: string | null;
}
export interface PhaseOutreach {
  campaignId: number; ordinal: number; roundName: string; roundType: string;
  coupons: Coupon[]; members: PhaseOutreachMember[];
}

/**
 * The campaign's current-round contact list, routed by cohort × value band with the recommended comm
 * plan + channel. Scoped: officers → their store, RMs → their zone, managers → all.
 */
export async function getPhaseOutreach(campaignId: number): Promise<PhaseOutreach | null> {
  const { role, storeId, zone } = await getScope();
  const camp = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { phases: { orderBy: { ordinal: "asc" } } },
  });
  if (!camp || !camp.phases.length) return null;
  const maxOrd = Math.max(...camp.phases.map((p) => p.ordinal));
  const ord = Math.min(camp.currentRound, maxOrd);
  const round = camp.phases.find((p) => p.ordinal === ord) ?? camp.phases[0];
  const commConfig = asCommConfig(round.commConfig);

  const where: Prisma.CampaignMemberWhereInput = { campaignId, group: "TEST" };
  if (role === "officer") { if (storeId == null) return null; where.storeId = storeId; }
  else if (role === "regional") { if (zone == null) return null; where.zone = zone; }

  const members = await prisma.campaignMember.findMany({ where, orderBy: { id: "asc" } });
  const farmerIds = members.map((m) => m.farmerId);
  const farmers = new Map((await prisma.farmer.findMany({ where: { id: { in: farmerIds } }, select: { id: true, name: true, mobile: true, village: true, store: { select: { name: true } } } })).map((f) => [f.id, f]));

  const out: PhaseOutreachMember[] = [];
  for (const m of members) {
    const status: MemberStatus = { booked: m.booked, boughtFertiliser: m.boughtFertiliser, boughtCombo: m.boughtCombo };
    const cohort = subCohortOf(round.type, status);
    if (!cohort) continue; // converted / done — not contacted this round
    const band = valueBand(m.valueSegment);
    const slot = commConfig[cohort]?.[band] ?? {};
    const f = farmers.get(m.farmerId);
    const cohortLabel = subCohortsFor(round.type).find((d) => d.key === cohort)?.label ?? cohort;
    out.push({
      memberId: m.id, farmerId: m.farmerId, name: f?.name ?? "Unknown", mobile: f?.mobile ?? null, village: f?.village ?? null,
      store: f?.store?.name ? (shortStoreName(f.store.name) || f.store.name) : null,
      valueBand: band, cohort, cohortLabel,
      booked: m.booked, boughtFertiliser: m.boughtFertiliser, boughtCombo: m.boughtCombo,
      reached: m.reached, mediums: m.mediums,
      recCommPlan: slot.commPlan ?? null, recChannel: slot.channel ?? null,
    });
  }
  return {
    campaignId, ordinal: ord, roundName: round.name, roundType: round.type,
    coupons: asCoupons(round.coupons), members: out,
  };
}
