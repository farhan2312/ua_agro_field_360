"use server";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { SEGMENT_COLUMNS, segMeta } from "@/lib/campaign-segments";
import { inr } from "@/lib/format";
import { cropLabel } from "@/lib/crops";
import { tagLabel } from "@/lib/crop-pest";
import { buildWorkbookB64 } from "@/lib/xlsx-export";
import { createClusterFromCriteria } from "@/app/actions/cluster-builder";
import type { ClusterCriteria } from "@/lib/cluster-rules";
import { getScope } from "@/lib/scope";
import { SPEND_TIERS } from "@/lib/spend-tiers";

export type Lens = "sales" | "visit";

export interface WbFilters {
  lens: Lens;
  storeId?: number | null;
  zone?: string;
  crop?: string; // matched against sales or visit crops depending on lens
  pest?: string; // Target Pest/Disease/Weed (item-code derived) — farmer attribute, both lenses
  segment?: string; // campaignSegment
  spendTier?: number | null; // index into SPEND_TIERS (sales lens)
  problem?: string; // visit lens
}

const num = (x: unknown) => (x == null ? 0 : Number(x));
const shortStore = (s: string) => s.replace(/\s*\(.*?\)\s*/g, "").trim() || s;

/* ── dynamic WHERE builder (safe: column names are literals, values parameterized) ── */
const col = (alias: string, name: string) => Prisma.raw(alias ? `${alias}."${name}"` : `"${name}"`);
function farmerConds(f: WbFilters, alias = ""): Prisma.Sql[] {
  const c: Prisma.Sql[] = [Prisma.sql`${col(alias, "source")} = 'REAL'`];
  if (f.storeId != null) c.push(Prisma.sql`${col(alias, "storeId")} = ${f.storeId}`);
  if (f.zone) c.push(Prisma.sql`${col(alias, "zone")} = ${f.zone}`);
  if (f.segment) c.push(Prisma.sql`${col(alias, "campaignSegment")} = ${f.segment}`);
  if (f.crop) {
    const cc = f.lens === "sales" ? "salesCropTags" : "visitCropTags";
    // Array-contains (@>) so the GIN index on the crop column is actually used.
    c.push(Prisma.sql`${col(alias, cc)} @> ARRAY[${f.crop}]::text[]`);
  }
  // Pests are a farmer attribute (item-code derived) — applies to both lenses. @> uses the GIN index.
  if (f.pest) c.push(Prisma.sql`${col(alias, "pestTags")} @> ARRAY[${f.pest}]::text[]`);
  if (f.lens === "sales" && f.spendTier != null && SPEND_TIERS[f.spendTier]) {
    const t = SPEND_TIERS[f.spendTier];
    // No COALESCE: null-spend farmers are excluded from every tier, matching the saved
    // segment's criteria (p12mSpend gte/lt) and the "No spend" distribution bucket.
    if (t.min != null) c.push(Prisma.sql`${col(alias, "p12mSpend")} >= ${t.min}`);
    if (t.max != null) c.push(Prisma.sql`${col(alias, "p12mSpend")} < ${t.max}`);
  }
  if (f.lens === "visit" && f.problem) {
    // Qualify the correlation to the OUTER farmer via `alias`; a bare "id" would bind to Visit.id.
    c.push(Prisma.sql`EXISTS (SELECT 1 FROM "Visit" v WHERE v."farmerId" = ${col(alias, "id")} AND ${f.problem} = ANY(v."currentProblem"))`);
  }
  return c;
}
const whereOf = (f: WbFilters, alias = "") => Prisma.sql`WHERE ${Prisma.join(farmerConds(f, alias), " AND ")}`;

/**
 * Enforce role scope on the workbench filters: an Agri Officer is pinned to their own store and a
 * Regional Manager to their own region — they can narrow further, but never widen past their scope,
 * whatever the client sends. Central/Sysadmin are unrestricted. "none" = a scoped user with no
 * store/region assigned (show nothing).
 */
async function scopeFilters(f: WbFilters): Promise<WbFilters | "none"> {
  const { role, storeId, zone } = await getScope();
  if (role === "officer") return storeId == null ? "none" : { ...f, storeId, zone: undefined };
  // RM: force their zone; a client storeId outside that zone simply yields no rows (zone AND store).
  if (role === "regional") return zone == null ? "none" : { ...f, zone };
  return f; // central / sysadmin
}

/* ── Facets for the filter bar ── */
export interface WbFacets {
  stores: { id: number; name: string }[];
  zones: string[];
  salesCrops: { crop: string; count: number }[];
  visitCrops: { crop: string; count: number }[];
  pests: { pest: string; count: number }[]; // item-code derived, both lenses
  problems: { problem: string; count: number }[];
  spendTiers: string[];
  years: number[]; // distinct sale years (for the crop-trend year filter), role-scoped
}
export async function getWorkbenchFacets(): Promise<WbFacets> {
  const { role, storeId, zone } = await getScope();
  const isOfficer = role === "officer", isRM = role === "regional";

  // Store dropdown: officer → only their store; RM → only their region's stores; else all.
  const storeWhere: Prisma.StoreWhereInput = isOfficer
    ? { id: storeId ?? -1 }
    : isRM ? (zone != null ? { zone } : { id: -1 }) : {};
  // Farmer-level scope predicate for the crop-facet COUNTS (so an officer doesn't see global crop totals).
  const fScope: Prisma.Sql = isOfficer
    ? (storeId != null ? Prisma.sql`"storeId" = ${storeId}` : Prisma.sql`false`)
    : isRM ? (zone != null ? Prisma.sql`"zone" = ${zone}` : Prisma.sql`false`)
    : Prisma.sql`true`;
  // Visit-level scope predicate (officer by the visit's store; RM by the visit's farmer zone).
  const vScope: Prisma.Sql = isOfficer
    ? (storeId != null ? Prisma.sql`v."storeId" = ${storeId}` : Prisma.sql`false`)
    : isRM ? (zone != null ? Prisma.sql`f."zone" = ${zone}` : Prisma.sql`false`)
    : Prisma.sql`true`;
  // Sale-line scope for the year facet (officer by store, RM by the store's zone).
  const slScope: Prisma.Sql = isOfficer
    ? (storeId != null ? Prisma.sql`AND sl."storeId" = ${storeId}` : Prisma.sql`AND false`)
    : isRM ? (zone != null ? Prisma.sql`AND EXISTS (SELECT 1 FROM "Store" st WHERE st.id = sl."storeId" AND st."zone" = ${zone})` : Prisma.sql`AND false`)
    : Prisma.empty;

  const [stores, zoneRows, sc, vc, pt, pr, yr] = await Promise.all([
    prisma.store.findMany({ where: storeWhere, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    isOfficer || isRM
      ? Promise.resolve([] as { zone: string | null }[])
      : prisma.farmer.findMany({ where: { zone: { not: null }, source: "REAL" }, distinct: ["zone"], select: { zone: true }, orderBy: { zone: "asc" } }),
    prisma.$queryRaw<{ crop: string; n: number }[]>(Prisma.sql`SELECT unnest("salesCropTags") crop, COUNT(*)::int n FROM "Farmer" WHERE source='REAL' AND ${fScope} GROUP BY 1 ORDER BY 2 DESC`),
    prisma.$queryRaw<{ crop: string; n: number }[]>(Prisma.sql`SELECT unnest("visitCropTags") crop, COUNT(*)::int n FROM "Farmer" WHERE source='REAL' AND ${fScope} GROUP BY 1 ORDER BY 2 DESC`),
    prisma.$queryRaw<{ pest: string; n: number }[]>(Prisma.sql`SELECT unnest("pestTags") pest, COUNT(*)::int n FROM "Farmer" WHERE source='REAL' AND ${fScope} GROUP BY 1 ORDER BY 2 DESC LIMIT 200`),
    prisma.$queryRaw<{ problem: string; n: number }[]>(Prisma.sql`SELECT unnest(v."currentProblem") problem, COUNT(*)::int n FROM "Visit" v JOIN "Farmer" f ON f.id = v."farmerId" WHERE array_length(v."currentProblem",1) > 0 AND ${vScope} GROUP BY 1 ORDER BY 2 DESC LIMIT 40`),
    prisma.$queryRaw<{ y: number }[]>(Prisma.sql`SELECT DISTINCT EXTRACT(YEAR FROM sl."soldAt")::int y FROM "SaleLine" sl WHERE sl."soldAt" IS NOT NULL ${slScope} ORDER BY 1`),
  ]);
  const zones = isRM ? (zone != null ? [zone] : []) : isOfficer ? [] : zoneRows.map((z) => z.zone!).filter(Boolean);
  return {
    stores: stores.map((s) => ({ id: s.id, name: shortStore(s.name) })),
    zones,
    salesCrops: sc.map((r) => ({ crop: r.crop, count: num(r.n) })),
    visitCrops: vc.map((r) => ({ crop: r.crop, count: num(r.n) })),
    pests: pt.map((r) => ({ pest: r.pest, count: num(r.n) })),
    problems: pr.map((r) => ({ problem: r.problem, count: num(r.n) })),
    spendTiers: SPEND_TIERS.map((t) => t.label),
    years: yr.map((r) => num(r.y)).filter(Boolean),
  };
}

/* ── The workbench data for the current filter ── */
export interface WbKpis { farmers: number; hni: number; potentialHni: number; atRisk: number; lapsed: number; spend: number; visits: number }
export interface MatrixRow { storeId: number | null; storeName: string; counts: Record<string, number>; total: number }
export interface WbBar { label: string; value: number; color?: string }
export interface WbData {
  kpis: WbKpis;
  matrix: { rows: MatrixRow[]; totals: Record<string, number>; grandTotal: number };
  segmentDist: WbBar[];
  cropBreakdown: WbBar[];
  extra: WbBar[]; // sales: spend-tier dist ; visit: problem dist
  extraTitle: string;
  secondary: WbBar[]; // sales: top zones by spend ; visit: officer activity
  secondaryTitle: string;
}

const EMPTY_WB: WbData = {
  kpis: { farmers: 0, hni: 0, potentialHni: 0, atRisk: 0, lapsed: 0, spend: 0, visits: 0 },
  matrix: { rows: [], totals: {}, grandTotal: 0 },
  segmentDist: [], cropBreakdown: [], extra: [], extraTitle: "", secondary: [], secondaryTitle: "",
};

export async function getWorkbench(f: WbFilters): Promise<WbData> {
  const scoped = await scopeFilters(f);
  if (scoped === "none") return EMPTY_WB; // scoped user with no store/region → nothing to show
  f = scoped;
  // Alias the outer Farmer as `f` everywhere so the visit-problem EXISTS correlates to Farmer.id
  // (a bare "id" would bind to Visit.id and collapse the visit lens to ~0).
  const whereF = whereOf(f, "f");

  const [kpiRows, matrixRows, segRows, cropRows, stores] = await Promise.all([
    prisma.$queryRaw<{ total: number; hni: number; phni: number; atrisk: number; lapsed: number; spend: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int total,
        COUNT(*) FILTER (WHERE f."campaignSegment"='HNI')::int hni,
        COUNT(*) FILTER (WHERE f."campaignSegment"='POTENTIAL_HNI')::int phni,
        COUNT(*) FILTER (WHERE f."campaignSegment"='AT_RISK')::int atrisk,
        COUNT(*) FILTER (WHERE f."campaignSegment"='LAPSED')::int lapsed,
        COALESCE(SUM(f."p12mSpend"),0)::float spend
      FROM "Farmer" f ${whereF}`),
    prisma.$queryRaw<{ storeId: number | null; seg: string; n: number }[]>(Prisma.sql`
      SELECT f."storeId" AS "storeId", f."campaignSegment" seg, COUNT(*)::int n FROM "Farmer" f ${whereF}
      AND f."campaignSegment" IS NOT NULL AND f."campaignSegment" <> 'OTHER' GROUP BY 1, 2`),
    prisma.$queryRaw<{ seg: string; n: number }[]>(Prisma.sql`
      SELECT f."campaignSegment" seg, COUNT(*)::int n FROM "Farmer" f ${whereF}
      AND f."campaignSegment" IS NOT NULL GROUP BY 1`),
    prisma.$queryRaw<{ crop: string; n: number }[]>(Prisma.sql`
      SELECT unnest(${col("f", f.lens === "sales" ? "salesCropTags" : "visitCropTags")}) crop, COUNT(*)::int n
      FROM "Farmer" f ${whereF} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`),
    prisma.store.findMany({ select: { id: true, name: true } }),
  ]);

  // Visits count only matters in the visit lens (avoids a wasted Visit join on every sales filter).
  let visits = 0;
  if (f.lens === "visit") {
    const vr = await prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int n FROM "Visit" v JOIN "Farmer" f ON f.id = v."farmerId" ${whereF}`);
    visits = num(vr[0]?.n);
  }

  // Lens-specific charts.
  let extra: WbBar[] = [], secondary: WbBar[] = [], extraTitle = "", secondaryTitle = "";
  if (f.lens === "sales") {
    const [spendRows, zoneRows] = await Promise.all([
      prisma.$queryRaw<{ bucket: string; n: number }[]>(Prisma.sql`
        SELECT CASE WHEN f."p12mSpend">=12000 THEN 'HNI ₹12K+'
          WHEN f."p12mSpend">=10000 THEN '₹10–12K' WHEN f."p12mSpend">=5000 THEN '₹5–10K'
          WHEN f."p12mSpend">=2500 THEN '₹2.5–5K' WHEN f."p12mSpend">0 THEN '< ₹2.5K' ELSE 'No spend' END bucket,
          COUNT(*)::int n FROM "Farmer" f ${whereF} GROUP BY 1`),
      prisma.$queryRaw<{ zone: string; spend: number }[]>(Prisma.sql`
        SELECT f."zone" AS zone, COALESCE(SUM(f."p12mSpend"),0)::float spend FROM "Farmer" f ${whereF}
        AND f."zone" IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    ]);
    const order = ["HNI ₹12K+", "₹10–12K", "₹5–10K", "₹2.5–5K", "< ₹2.5K", "No spend"];
    extra = spendRows.map((r) => ({ label: r.bucket, value: num(r.n) })).sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
    extraTitle = "Spend tiers (P12M)";
    secondary = zoneRows.map((r) => ({ label: r.zone, value: num(r.spend) }));
    secondaryTitle = "Top zones by P12M spend";
  } else {
    const [probRows, offRows] = await Promise.all([
      prisma.$queryRaw<{ problem: string; n: number }[]>(Prisma.sql`
        SELECT unnest(v."currentProblem") problem, COUNT(DISTINCT v."farmerId")::int n
        FROM "Visit" v JOIN "Farmer" f ON f.id=v."farmerId" ${whereF}
        AND array_length(v."currentProblem",1) > 0 GROUP BY 1 ORDER BY 2 DESC LIMIT 12`),
      prisma.$queryRaw<{ officer: string; n: number }[]>(Prisma.sql`
        SELECT v."officerName" officer, COUNT(*)::int n
        FROM "Visit" v JOIN "Farmer" f ON f.id=v."farmerId" ${whereF}
        AND v."officerName" IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    ]);
    extra = probRows.map((r) => ({ label: r.problem, value: num(r.n) }));
    extraTitle = "Field problems (farmers)";
    secondary = offRows.map((r) => ({ label: r.officer, value: num(r.n) }));
    secondaryTitle = "Officer visit activity";
  }

  const nameById = new Map(stores.map((s) => [s.id, shortStore(s.name)]));
  const byStore = new Map<number | null, Record<string, number>>();
  const totals: Record<string, number> = {};
  for (const g of matrixRows) {
    const m = byStore.get(g.storeId) ?? {};
    m[g.seg] = num(g.n); byStore.set(g.storeId, m);
    totals[g.seg] = (totals[g.seg] ?? 0) + num(g.n);
  }
  const rows: MatrixRow[] = [...byStore.entries()].map(([storeId, counts]) => ({
    storeId, storeName: storeId == null ? "Unassigned" : nameById.get(storeId) ?? `Store #${storeId}`,
    counts, total: SEGMENT_COLUMNS.reduce((s, k) => s + (counts[k] ?? 0), 0),
  })).sort((a, b) => b.total - a.total).slice(0, 100);
  const grandTotal = SEGMENT_COLUMNS.reduce((s, k) => s + (totals[k] ?? 0), 0);

  const k = kpiRows[0] ?? { total: 0, hni: 0, phni: 0, atrisk: 0, lapsed: 0, spend: 0 };
  const segMap = new Map(segRows.map((r) => [r.seg, num(r.n)]));
  return {
    kpis: { farmers: num(k.total), hni: num(k.hni), potentialHni: num(k.phni), atRisk: num(k.atrisk), lapsed: num(k.lapsed), spend: num(k.spend), visits },
    matrix: { rows, totals, grandTotal },
    segmentDist: SEGMENT_COLUMNS.map((s) => ({ label: segMeta(s).label, value: segMap.get(s) ?? 0, color: segMeta(s).color })),
    cropBreakdown: cropRows.map((r) => ({ label: r.crop, value: num(r.n) })),
    extra, extraTitle, secondary, secondaryTitle,
  };
}

/* ── Visit analytics: PURELY what the field-visit wizard collects (no sales data) ── */
export interface VisitKpis {
  visits: number; farmers: number; villages: number; officers: number;
  fieldPct: number; photos: number; voiceNotes: number; whatsappPct: number;
}
export interface VisitMonth { ym: string; label: string; year: number; count: number }
export interface VisitAdoption { label: string; count: number; pct: number }
export interface VisitStoreRow { store: string; visits: number; farmers: number }
export interface VisitAnalytics {
  kpis: VisitKpis;
  monthly: VisitMonth[];
  purposes: WbBar[];
  problems: WbBar[];
  crops: WbBar[];
  water: WbBar[];
  landHolding: WbBar[];
  expense: WbBar[];
  productsUsed: WbBar[];
  productsNeeded: WbBar[];
  soilTypes: WbBar[];
  purchaseFreq: WbBar[];
  risks: WbBar[];
  adoption: VisitAdoption[];
  officers: WbBar[];
  byStore: VisitStoreRow[];
}

const EMPTY_VISITS: VisitAnalytics = {
  kpis: { visits: 0, farmers: 0, villages: 0, officers: 0, fieldPct: 0, photos: 0, voiceNotes: 0, whatsappPct: 0 },
  monthly: [], purposes: [], problems: [], crops: [], water: [], landHolding: [], expense: [],
  productsUsed: [], productsNeeded: [], soilTypes: [], purchaseFreq: [], risks: [], adoption: [], officers: [], byStore: [],
};

// Canonical bucket orders from the visit wizard's option catalog.
const LAND_ORDER = ["< 1 Bigha", "1–3 Bigha", "3–5 Bigha", "5–10 Bigha", "10–20 Bigha", "20–50 Bigha", "50–100 Bigha", "100+ Bigha"];
const EXPENSE_ORDER = ["< ₹10K", "₹10–25K", "₹25–50K", "₹50K–1L", "₹1–2.5L", "₹2.5L+"];
const FREQ_ORDER = ["Weekly", "Monthly", "Seasonal", "As Required"];
const orderBars = (bars: WbBar[], order: string[]) =>
  [...bars].sort((a, b) => {
    const ia = order.indexOf(a.label), ib = order.indexOf(b.label);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

/** Everything the field team collects on visits, aggregated over the filtered farmer set's visits. */
export async function getVisitAnalytics(f: WbFilters): Promise<VisitAnalytics> {
  const scoped = await scopeFilters({ ...f, lens: "visit" });
  if (scoped === "none") return EMPTY_VISITS;
  const whereF = whereOf(scoped, "f");
  const BASE = Prisma.sql`FROM "Visit" v JOIN "Farmer" f ON f.id = v."farmerId" ${whereF}`;
  const bars = (rows: { x: string | null; n: number }[]): WbBar[] =>
    rows.filter((r) => r.x != null && r.x !== "").map((r) => ({ label: r.x as string, value: num(r.n) }));

  const [kpiRows, monthlyRows, purposeRows, problemRows, cropRows] = await Promise.all([
    prisma.$queryRaw<{ visits: number; farmers: number; villages: number; officers: number; field: number; photos: number; voices: number; wa: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int visits, COUNT(DISTINCT v."farmerId")::int farmers,
        COUNT(DISTINCT f."village")::int villages, COUNT(DISTINCT v."officerName")::int officers,
        COUNT(*) FILTER (WHERE v."visitMode" = 'field')::int field,
        COALESCE(SUM(cardinality(v."photos")), 0)::int photos,
        COALESCE(SUM(cardinality(v."voiceNotes")), 0)::int voices,
        COUNT(*) FILTER (WHERE v."whatsappAvail")::int wa
      ${BASE}`),
    prisma.$queryRaw<{ ym: string; n: number }[]>(Prisma.sql`
      SELECT to_char(date_trunc('month', v."visitedAt"), 'YYYY-MM') ym, COUNT(*)::int n
      ${BASE} AND v."visitedAt" IS NOT NULL GROUP BY 1 ORDER BY 1`),
    prisma.$queryRaw<{ x: string | null; n: number }[]>(Prisma.sql`
      SELECT COALESCE(NULLIF(TRIM(v."purpose"), ''), 'Not recorded') x, COUNT(*)::int n ${BASE} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    prisma.$queryRaw<{ x: string | null; n: number }[]>(Prisma.sql`
      SELECT p x, COUNT(DISTINCT fid)::int n
      FROM (SELECT v."farmerId" fid, unnest(v."currentProblem") p ${BASE}) t
      GROUP BY 1 ORDER BY 2 DESC LIMIT 12`),
    prisma.$queryRaw<{ x: string | null; n: number }[]>(Prisma.sql`
      SELECT c x, COUNT(*)::int n FROM (SELECT unnest(array_append(v."crops", v."mainCrop")) c ${BASE}) t
      WHERE c IS NOT NULL AND c <> '' GROUP BY 1 ORDER BY 2 DESC LIMIT 12`),
  ]);

  const [waterRows, landRows, expenseRows, usedRows, neededRows] = await Promise.all([
    prisma.$queryRaw<{ x: string | null; n: number }[]>(Prisma.sql`
      SELECT w x, COUNT(*)::int n FROM (SELECT unnest(v."waterSource") w ${BASE}) t GROUP BY 1 ORDER BY 2 DESC LIMIT 9`),
    prisma.$queryRaw<{ x: string | null; n: number }[]>(Prisma.sql`
      SELECT v."landHoldingUnit" x, COUNT(*)::int n ${BASE} AND v."landHoldingUnit" IS NOT NULL GROUP BY 1`),
    prisma.$queryRaw<{ x: string | null; n: number }[]>(Prisma.sql`
      SELECT v."annualExpense" x, COUNT(*)::int n ${BASE} AND v."annualExpense" IS NOT NULL GROUP BY 1`),
    prisma.$queryRaw<{ x: string | null; n: number }[]>(Prisma.sql`
      SELECT p x, COUNT(*)::int n FROM (SELECT unnest(v."products") p ${BASE}) t GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    prisma.$queryRaw<{ x: string | null; n: number }[]>(Prisma.sql`
      SELECT p x, COUNT(*)::int n FROM (SELECT unnest(v."productRequired") p ${BASE}) t GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
  ]);

  const [soilRows, freqRows, riskRows, adoptRows, officerRows, storeRows] = await Promise.all([
    prisma.$queryRaw<{ x: string | null; n: number }[]>(Prisma.sql`
      SELECT v."soilType" x, COUNT(*)::int n ${BASE} AND v."soilType" IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    prisma.$queryRaw<{ x: string | null; n: number }[]>(Prisma.sql`
      SELECT v."purchaseFreq" x, COUNT(*)::int n ${BASE} AND v."purchaseFreq" IS NOT NULL GROUP BY 1`),
    prisma.$queryRaw<{ x: string | null; n: number }[]>(Prisma.sql`
      SELECT r x, COUNT(*)::int n FROM (SELECT unnest(v."cropRisk") r ${BASE}) t GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    prisma.$queryRaw<{ fpo: number; contract: number; dairy: number; wa: number; insured: number; soil: number }[]>(Prisma.sql`
      SELECT COUNT(*) FILTER (WHERE v."fpoMember")::int fpo,
        COUNT(*) FILTER (WHERE v."contractFarming")::int contract,
        COUNT(*) FILTER (WHERE v."dairyServices")::int dairy,
        COUNT(*) FILTER (WHERE v."whatsappAvail")::int wa,
        COUNT(*) FILTER (WHERE v."cropInsured")::int insured,
        COUNT(*) FILTER (WHERE v."soilTesting" = 'Required')::int soil
      ${BASE}`),
    prisma.$queryRaw<{ x: string | null; n: number }[]>(Prisma.sql`
      SELECT v."officerName" x, COUNT(*)::int n ${BASE} AND v."officerName" IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    prisma.$queryRaw<{ store: string | null; visits: number; farmers: number }[]>(Prisma.sql`
      SELECT st."name" store, COUNT(*)::int visits, COUNT(DISTINCT v."farmerId")::int farmers
      FROM "Visit" v JOIN "Farmer" f ON f.id = v."farmerId" LEFT JOIN "Store" st ON st.id = v."storeId"
      ${whereF} GROUP BY 1 ORDER BY 2 DESC LIMIT 15`),
  ]);

  const k = kpiRows[0];
  const visits = num(k?.visits);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthly: VisitMonth[] = monthlyRows.map((r) => {
    const [y, m] = r.ym.split("-").map(Number);
    return { ym: r.ym, label: MONTHS[m - 1], year: y, count: num(r.n) };
  });
  const a = adoptRows[0];
  const pct = (x: number) => (visits ? Math.round((x / visits) * 100) : 0);
  const adoption: VisitAdoption[] = [
    { label: "WhatsApp available", count: num(a?.wa), pct: pct(num(a?.wa)) },
    { label: "Soil testing required", count: num(a?.soil), pct: pct(num(a?.soil)) },
    { label: "Crop insured", count: num(a?.insured), pct: pct(num(a?.insured)) },
    { label: "FPO member", count: num(a?.fpo), pct: pct(num(a?.fpo)) },
    { label: "Contract farming", count: num(a?.contract), pct: pct(num(a?.contract)) },
    { label: "Dairy services", count: num(a?.dairy), pct: pct(num(a?.dairy)) },
  ];

  return {
    kpis: {
      visits,
      farmers: num(k?.farmers),
      villages: num(k?.villages),
      officers: num(k?.officers),
      fieldPct: pct(num(k?.field)),
      photos: num(k?.photos),
      voiceNotes: num(k?.voices),
      whatsappPct: pct(num(k?.wa)),
    },
    monthly,
    purposes: bars(purposeRows),
    problems: bars(problemRows),
    crops: bars(cropRows),
    water: bars(waterRows),
    landHolding: orderBars(bars(landRows), LAND_ORDER),
    expense: orderBars(bars(expenseRows), EXPENSE_ORDER),
    productsUsed: bars(usedRows),
    productsNeeded: bars(neededRows),
    soilTypes: bars(soilRows),
    purchaseFreq: orderBars(bars(freqRows), FREQ_ORDER),
    risks: bars(riskRows),
    adoption,
    officers: bars(officerRows),
    byStore: storeRows.filter((r) => r.store).map((r) => ({ store: r.store as string, visits: num(r.visits), farmers: num(r.farmers) })),
  };
}

/* ── Drill: farmers in a matrix cell (respects the active filters) ── */
export interface WbCustomer { id: number; name: string; mobile: string | null; village: string | null; spend: string; segment: string; salesCrops: string[]; visitCrops: string[] }
export async function getWorkbenchCustomers(f: WbFilters, storeId: number | null, segment: string, limit = 400): Promise<WbCustomer[]> {
  // Scope LAST (after applying the clicked cell's store) so an officer/RM can't drill into a foreign store.
  const scoped = await scopeFilters({ ...f, storeId: storeId ?? undefined, segment });
  if (scoped === "none") return [];
  const conds = farmerConds(scoped, "f"); // alias f so the visit-problem EXISTS correlates to Farmer.id
  if (storeId == null && scoped.storeId == null) conds.push(Prisma.sql`f."storeId" IS NULL`);
  const rows = await prisma.$queryRaw<{ id: number; name: string; mobile: string | null; village: string | null; spend: number | null; seg: string | null; salesc: string[]; visitc: string[] }[]>(Prisma.sql`
    SELECT f.id, f.name, f.mobile, f.village, f."p12mSpend" spend, f."campaignSegment" seg, f."salesCropTags" salesc, f."visitCropTags" visitc
    FROM "Farmer" f WHERE ${Prisma.join(conds, " AND ")}
    ORDER BY f."p12mSpend" DESC NULLS LAST LIMIT ${limit}`);
  return rows.map((r) => ({
    id: r.id, name: r.name, mobile: r.mobile, village: r.village,
    spend: r.spend != null ? inr(r.spend) : "—", segment: r.seg ?? "—",
    salesCrops: r.salesc ?? [], visitCrops: r.visitc ?? [],
  }));
}

/* ── Export the workbench Segment × Store table + the full filtered farmer list to Excel ── */
const FARMER_EXPORT_CAP = 200000; // covers the whole REAL farmer base; the note row fires only past it

export async function exportWorkbookXlsx(f: WbFilters): Promise<{ ok: boolean; filename?: string; b64?: string; error?: string }> {
  const scoped = await scopeFilters(f);
  if (scoped === "none") return { ok: false, error: "No store or region is assigned to your account." };
  const whereF = whereOf(scoped, "f");

  const [matrixRows, stores, farmerRows] = await Promise.all([
    prisma.$queryRaw<{ storeId: number | null; seg: string; n: number }[]>(Prisma.sql`
      SELECT f."storeId" AS "storeId", f."campaignSegment" seg, COUNT(*)::int n FROM "Farmer" f ${whereF}
      AND f."campaignSegment" IS NOT NULL AND f."campaignSegment" <> 'OTHER' GROUP BY 1, 2`),
    prisma.store.findMany({ select: { id: true, name: true } }),
    prisma.$queryRaw<{ name: string; mobile: string | null; village: string | null; zone: string | null; storeId: number | null; seg: string | null; spend: number | null; salesc: string[]; visitc: string[]; pests: string[] }[]>(Prisma.sql`
      SELECT f.name, f.mobile, f.village, f."zone" AS zone, f."storeId" AS "storeId", f."campaignSegment" seg,
        f."p12mSpend" spend, f."salesCropTags" salesc, f."visitCropTags" visitc, f."pestTags" pests
      FROM "Farmer" f ${whereF} ORDER BY f."p12mSpend" DESC NULLS LAST LIMIT ${FARMER_EXPORT_CAP}`),
  ]);

  const nameById = new Map(stores.map((s) => [s.id, shortStore(s.name)]));

  // Matrix — identical shape to the on-screen table (top 100 stores by total, All-stores summary row).
  const byStore = new Map<number | null, Record<string, number>>();
  const totals: Record<string, number> = {};
  for (const g of matrixRows) {
    const m = byStore.get(g.storeId) ?? {};
    m[g.seg] = num(g.n); byStore.set(g.storeId, m);
    totals[g.seg] = (totals[g.seg] ?? 0) + num(g.n);
  }
  const mrows = [...byStore.entries()].map(([storeId, counts]) => ({
    storeName: storeId == null ? "Unassigned" : nameById.get(storeId) ?? `Store #${storeId}`,
    counts, total: SEGMENT_COLUMNS.reduce((s, k) => s + (counts[k] ?? 0), 0),
  })).sort((a, b) => b.total - a.total).slice(0, 100);
  const grand = SEGMENT_COLUMNS.reduce((s, k) => s + (totals[k] ?? 0), 0);

  const segLabels = SEGMENT_COLUMNS.map((s) => segMeta(s).label);
  const matrixSheet: (string | number)[][] = [
    ["Store", ...segLabels, "Total"],
    ["All stores", ...SEGMENT_COLUMNS.map((s) => totals[s] ?? 0), grand],
    ...mrows.map((r) => [r.storeName, ...SEGMENT_COLUMNS.map((s) => r.counts[s] ?? 0), r.total]),
  ];

  const farmerSheet: (string | number)[][] = [
    ["Farmer", "Mobile", "Store", "Region", "Village", "Segment", "P12M Spend (₹)", "Sales crops", "Visit crops", "Target pests / diseases"],
    ...farmerRows.map((r) => [
      r.name, r.mobile ?? "", r.storeId != null ? nameById.get(r.storeId) ?? "" : "", r.zone ?? "", r.village ?? "",
      r.seg ? segMeta(r.seg).label : "—", r.spend ?? 0,
      (r.salesc ?? []).map(cropLabel).join(", "), (r.visitc ?? []).map(cropLabel).join(", "), (r.pests ?? []).map(tagLabel).join(", "),
    ]),
  ];
  if (farmerRows.length >= FARMER_EXPORT_CAP) {
    farmerSheet.push([`Note: list capped at ${FARMER_EXPORT_CAP.toLocaleString("en-IN")} farmers (by P12M spend). Narrow the filters for a complete set.`]);
  }

  const b64 = buildWorkbookB64([
    { name: "Segment x Store", rows: matrixSheet },
    { name: "Farmers", rows: farmerSheet },
  ]);
  const today = new Date().toISOString().slice(0, 10);
  return { ok: true, filename: `analytics-segments-${today}.xlsx`, b64 };
}

/* ── Crop purchase trend: monthly ₹ for one crop (per-line crop from the master file) ── */
export interface CropTrendPoint {
  ym: string; // "2025-06"
  label: string; // "Jun"
  year: number;
  season: "Kharif" | "Rabi" | "Zaid";
  revenue: number; // ₹ (line totals)
  lines: number; // sale lines
}

/** Monthly purchase trend (SaleLine), role-scoped. No crop → every crop's sale lines combined. */
export async function getCropTrend(crop: string): Promise<CropTrendPoint[]> {
  const safe = (crop || "").toLowerCase().replace(/[^a-z_]/g, "");
  const { role, storeId, zone } = await getScope();
  const scopeSql: Prisma.Sql =
    role === "officer"
      ? storeId != null ? Prisma.sql`AND sl."storeId" = ${storeId}` : Prisma.sql`AND false`
      : role === "regional"
        ? zone != null
          ? Prisma.sql`AND EXISTS (SELECT 1 FROM "Store" st WHERE st.id = sl."storeId" AND st."zone" = ${zone})`
          : Prisma.sql`AND false`
        : Prisma.empty;
  const cropCond = safe ? Prisma.sql`sl."cropTag" = ${safe} AND ` : Prisma.empty;
  const rows = await prisma.$queryRaw<{ ym: string; rev: number; lines: number }[]>(Prisma.sql`
    SELECT to_char(date_trunc('month', sl."soldAt"), 'YYYY-MM') ym,
           COALESCE(SUM(sl."totalPrice"), 0)::float rev, COUNT(*)::int lines
    FROM "SaleLine" sl
    WHERE ${cropCond}sl."soldAt" IS NOT NULL ${scopeSql}
    GROUP BY 1 ORDER BY 1`);
  if (!rows.length) return [];

  // Continuous timeline: fill month gaps between the first and last sale with zeros.
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const byYm = new Map(rows.map((r) => [r.ym, r]));
  const [fy, fm] = rows[0].ym.split("-").map(Number);
  const [ly, lm] = rows[rows.length - 1].ym.split("-").map(Number);
  const out: CropTrendPoint[] = [];
  for (let y = fy, m = fm; y < ly || (y === ly && m <= lm); m === 12 ? (y++, m = 1) : m++) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    const r = byYm.get(ym);
    // North-India cropping seasons: Kharif Jun–Oct · Rabi Nov–Mar · Zaid Apr–May.
    const season: CropTrendPoint["season"] = m >= 6 && m <= 10 ? "Kharif" : m === 4 || m === 5 ? "Zaid" : "Rabi";
    out.push({ ym, label: MONTHS[m - 1], year: y, season, revenue: Math.round(num(r?.rev)), lines: num(r?.lines) });
  }
  return out;
}

/* ── Save the current filter as a live dynamic segment ── */
export async function saveWorkbenchSegment(f: WbFilters, name: string): Promise<{ ok: boolean; id?: number; error?: string }> {
  const scoped = await scopeFilters(f);
  if (scoped === "none") return { ok: false, error: "No store or region is assigned to your account." };
  f = scoped; // saved segment inherits the officer's store / RM's region
  const tier = f.lens === "sales" && f.spendTier != null ? SPEND_TIERS[f.spendTier] : undefined;
  const criteria: ClusterCriteria = {
    storeIds: f.storeId != null ? [f.storeId] : undefined,
    zone: f.zone || undefined,
    campaignSegments: f.segment ? [f.segment] : undefined,
    salesCrops: f.lens === "sales" && f.crop ? [f.crop] : undefined,
    visitCrops: f.lens === "visit" && f.crop ? [f.crop] : undefined,
    pestTags: f.pest ? [f.pest] : undefined,
    visitProblem: f.lens === "visit" ? f.problem || undefined : undefined,
    spendMin: tier?.min, spendMax: tier?.max,
  };
  return createClusterFromCriteria({ name, criteria, origin: "analytics", mode: "dynamic" });
}
