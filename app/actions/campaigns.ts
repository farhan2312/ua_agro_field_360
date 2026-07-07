"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { shortStoreName } from "@/lib/store-utils";
import { SEGMENT_COLUMNS, segMeta } from "@/lib/campaign-segments";
import { inr } from "@/lib/format";

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
  segments: string[];
  crops: string[]; // maize / potato (empty = all)
  storeIds?: number[]; // optional scope
  testPct?: number;
}

export async function createCampaign(input: CreateCampaignInput): Promise<{ ok: boolean; id?: number; members?: number; error?: string }> {
  try {
    if (!input.name.trim()) return { ok: false, error: "Name is required." };
    if (!input.segments.length) return { ok: false, error: "Pick at least one segment." };
    const camp = await prisma.campaign.create({
      data: {
        name: input.name.trim(),
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
        targetSegments: input.segments,
        targetCrops: input.crops,
        testPct: input.testPct ?? 75,
        status: "ACTIVE",
      },
    });
    // Enrol matching farmers, split 75/25 test/control by a deterministic id hash.
    const farmers = await prisma.farmer.findMany({
      where: {
        campaignSegment: { in: input.segments },
        ...(input.storeIds?.length ? { storeId: { in: input.storeIds } } : {}),
        ...(input.crops.length ? { cropTags: { hasSome: input.crops } } : {}),
      },
      select: { id: true, campaignSegment: true, cropTags: true },
    });
    const controlEvery = Math.max(2, Math.round(100 / (100 - (input.testPct ?? 75)))); // ~4 for 75/25
    const members = farmers.map((f) => ({
      campaignId: camp.id,
      farmerId: f.id,
      segment: f.campaignSegment ?? "OTHER",
      crop: f.cropTags[0] ?? null,
      group: f.id % controlEvery === 0 ? "CONTROL" : "TEST",
    }));
    for (let i = 0; i < members.length; i += 5000) {
      await prisma.campaignMember.createMany({ data: members.slice(i, i + 5000), skipDuplicates: true });
    }
    revalidatePath("/campaigns");
    return { ok: true, id: camp.id, members: members.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Create failed" };
  }
}

export interface CampaignListItem {
  id: number; name: string; status: string; startDate: string; endDate: string;
  segments: string[]; members: number;
}

export async function listCampaigns(): Promise<CampaignListItem[]> {
  const camps = await prisma.campaign.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { members: true } } },
  });
  return camps.map((c) => ({
    id: c.id, name: c.name, status: c.status,
    startDate: c.startDate.toISOString().slice(0, 10),
    endDate: c.endDate.toISOString().slice(0, 10),
    segments: c.targetSegments, members: c._count.members,
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
