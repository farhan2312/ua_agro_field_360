"use server";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { segMeta, VALUE_SEGMENTS, LIFECYCLE_SEGMENTS, VALUE_HNI_MIN, VALUE_POTENTIAL_MIN, LIFECYCLE_NEW_MAX_MONTHS, LIFECYCLE_LAPSED_MIN_MONTHS } from "@/lib/campaign-segments";
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
  storeIds?: number[];       // stores — match ANY
  zones?: string[];          // regions — match ANY
  crops?: string[];          // crops (sales or visit depending on lens) — match ANY (array overlap)
  pests?: string[];          // Target Pests/Diseases/Weeds — match ANY (array overlap)
  valueSegments?: string[];  // value tier(s): HNI | POTENTIAL_HNI | REGULAR (FY-dynamic in sales lens)
  lifecycleSegments?: string[]; // lifecycle stage(s): NEW | AT_RISK | LAPSED (FY-dynamic in sales lens)
  spendTiers?: number[];     // indices into SPEND_TIERS — FY spend, match ANY range
  fyStarts?: number[];       // selected financial-year start years (Apr Y→Mar Y+1); drives the sales segmentation
  problems?: string[];       // visit lens — match ANY
}

const num = (x: unknown) => (x == null ? 0 : Number(x));
const shortStore = (s: string) => s.replace(/\s*\(.*?\)\s*/g, "").trim() || s;

/* ── dynamic WHERE builder (safe: column names are literals, values parameterized) ── */
const col = (alias: string, name: string) => Prisma.raw(alias ? `${alias}."${name}"` : `"${name}"`);
/** OR-of-ranges for the selected spend tiers, against a numeric column/expression. */
function spendTierOr(tiers: number[] | undefined, expr: Prisma.Sql): Prisma.Sql | null {
  if (!tiers?.length) return null;
  const ors = tiers.map((i) => SPEND_TIERS[i]).filter(Boolean).map((t) => {
    const parts: Prisma.Sql[] = [];
    if (t.min != null) parts.push(Prisma.sql`${expr} >= ${t.min}`);
    if (t.max != null) parts.push(Prisma.sql`${expr} < ${t.max}`);
    return parts.length ? Prisma.sql`(${Prisma.join(parts, " AND ")})` : Prisma.sql`TRUE`;
  });
  return ors.length ? Prisma.sql`(${Prisma.join(ors, " OR ")})` : null;
}
/** Static farmer attributes only — source/store/zone/crop/pest (+ visit problem). NOT value/lifecycle/spend. */
function staticConds(f: WbFilters, alias = ""): Prisma.Sql[] {
  const c: Prisma.Sql[] = [Prisma.sql`${col(alias, "source")} = 'REAL'`];
  if (f.storeIds?.length) c.push(Prisma.sql`${col(alias, "storeId")} = ANY(${f.storeIds})`);
  if (f.zones?.length) c.push(Prisma.sql`${col(alias, "zone")} = ANY(${f.zones})`);
  if (f.crops?.length) {
    const cc = f.lens === "sales" ? "salesCropTags" : "visitCropTags";
    c.push(Prisma.sql`${col(alias, cc)} && ${f.crops}::text[]`); // array overlap — uses the GIN index
  }
  if (f.pests?.length) c.push(Prisma.sql`${col(alias, "pestTags")} && ${f.pests}::text[]`);
  if (f.lens === "visit" && f.problems?.length) {
    c.push(Prisma.sql`EXISTS (SELECT 1 FROM "Visit" v WHERE v."farmerId" = ${col(alias, "id")} AND v."currentProblem" && ${f.problems}::text[])`);
  }
  return c;
}
/** Static conds + the precomputed value/lifecycle/spend columns (used by the visit lens + facets). */
function farmerConds(f: WbFilters, alias = ""): Prisma.Sql[] {
  const c = staticConds(f, alias);
  if (f.valueSegments?.length) c.push(Prisma.sql`${col(alias, "valueSegment")} = ANY(${f.valueSegments})`);
  if (f.lifecycleSegments?.length) c.push(Prisma.sql`${col(alias, "lifecycleSegment")} = ANY(${f.lifecycleSegments})`);
  if (f.lens === "sales") { const s = spendTierOr(f.spendTiers, col(alias, "p12mSpend")); if (s) c.push(s); }
  return c;
}

/* ── FY-dynamic sales segmentation (value/lifecycle computed live from Sale within the selected FY) ── */
/** FY window (spend filter) + as-of date (lifecycle cutoff) for the Sale alias `s`. */
function fyBounds(fyStarts: number[]): { windowSql: Prisma.Sql; asOfSql: Prisma.Sql } {
  if (!fyStarts.length) return { windowSql: Prisma.sql`TRUE`, asOfSql: Prisma.sql`now()` };
  const maxY = Math.max(...fyStarts);
  const asOfSql = Prisma.sql`${`${maxY + 1}-04-01`}::timestamptz`;
  const ors = fyStarts.map((y) => Prisma.sql`(s."soldAt" >= ${`${y}-04-01`}::timestamptz AND s."soldAt" < ${`${y + 1}-04-01`}::timestamptz)`);
  return { windowSql: Prisma.sql`(${Prisma.join(ors, " OR ")})`, asOfSql };
}
/** The scoped→agg→tiers CTE: per-farmer FY spend + last purchase → live value/lifecycle tier. */
function tiersCte(f: WbFilters): Prisma.Sql {
  const { windowSql, asOfSql } = fyBounds(f.fyStarts ?? []);
  const where = Prisma.sql`WHERE ${Prisma.join(staticConds(f, "f"), " AND ")}`;
  const newM = Prisma.raw(String(LIFECYCLE_NEW_MAX_MONTHS)), lapsedM = Prisma.raw(String(LIFECYCLE_LAPSED_MIN_MONTHS));
  return Prisma.sql`
    scoped AS (SELECT f.id, f."storeId", f."zone" FROM "Farmer" f ${where}),
    agg AS (
      SELECT sc.id, sc."storeId", sc."zone",
        COALESCE(SUM(s."amountNum") FILTER (WHERE ${windowSql}), 0)::bigint spend,
        MAX(s."soldAt") FILTER (WHERE s."soldAt" < ${asOfSql}) last_at
      FROM scoped sc LEFT JOIN "Sale" s ON s."farmerId" = sc.id AND s.source = 'REAL' AND s."soldAt" IS NOT NULL
      GROUP BY 1, 2, 3),
    tiers AS (
      SELECT id, "storeId", "zone", spend,
        CASE WHEN spend >= ${VALUE_HNI_MIN} THEN 'HNI' WHEN spend >= ${VALUE_POTENTIAL_MIN} THEN 'POTENTIAL_HNI' ELSE 'REGULAR' END vseg,
        CASE WHEN last_at IS NULL THEN 'LAPSED'
          WHEN last_at > ${asOfSql} - interval '${newM} months' THEN 'NEW'
          WHEN last_at > ${asOfSql} - interval '${lapsedM} months' THEN 'AT_RISK'
          ELSE 'LAPSED' END lseg
      FROM agg)`;
}
/** Dynamic filter on the tiers CTE — value/lifecycle/FY-spend selections. */
function tierFilter(f: WbFilters): Prisma.Sql {
  const c: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (f.valueSegments?.length) c.push(Prisma.sql`vseg = ANY(${f.valueSegments})`);
  if (f.lifecycleSegments?.length) c.push(Prisma.sql`lseg = ANY(${f.lifecycleSegments})`);
  const s = spendTierOr(f.spendTiers, Prisma.sql`spend`); if (s) c.push(s);
  return Prisma.join(c, " AND ");
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
  if (role === "officer") return storeId == null ? "none" : { ...f, storeIds: [storeId], zones: undefined };
  // RM: force their zone; a client store outside that zone simply yields no rows (zone AND store).
  if (role === "regional") return zone == null ? "none" : { ...f, zones: [zone] };
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
  years: number[]; // distinct financial-year start years (Apr–Mar) for the crop-trend FY filter, role-scoped
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
    // Distinct financial-year START years (Apr–Mar): Jan–Mar count toward the previous FY.
    prisma.$queryRaw<{ y: number }[]>(Prisma.sql`SELECT DISTINCT (EXTRACT(YEAR FROM sl."soldAt")::int - CASE WHEN EXTRACT(MONTH FROM sl."soldAt") < 4 THEN 1 ELSE 0 END) y FROM "SaleLine" sl WHERE sl."soldAt" IS NOT NULL ${slScope} ORDER BY 1`),
  ]);
  const zones = isRM ? (zone != null ? [zone] : []) : isOfficer ? [] : zoneRows.map((z) => z.zone!).filter(Boolean);
  const abc = (a: string, b: string) => a.localeCompare(b); // filter option lists sorted A→Z for scan-ability
  return {
    stores: stores.map((s) => ({ id: s.id, name: shortStore(s.name) })).sort((a, b) => abc(a.name, b.name)),
    zones: [...zones].sort(abc),
    salesCrops: sc.map((r) => ({ crop: r.crop, count: num(r.n) })).sort((a, b) => abc(cropLabel(a.crop), cropLabel(b.crop))),
    visitCrops: vc.map((r) => ({ crop: r.crop, count: num(r.n) })).sort((a, b) => abc(cropLabel(a.crop), cropLabel(b.crop))),
    pests: pt.map((r) => ({ pest: r.pest, count: num(r.n) })).sort((a, b) => abc(tagLabel(a.pest), tagLabel(b.pest))),
    problems: pr.map((r) => ({ problem: r.problem, count: num(r.n) })).sort((a, b) => abc(a.problem, b.problem)),
    spendTiers: SPEND_TIERS.map((t) => t.label),
    years: yr.map((r) => num(r.y)).filter(Boolean),
  };
}

/* ── The workbench data for the current filter ── */
export interface WbKpis { farmers: number; spend: number; visits: number }
export interface WbBar { label: string; value: number; color?: string }
/** One store row of the merged Value + Lifecycle table (both count-sets sum to `total`). */
export interface MergedRow { storeId: number | null; storeName: string; value: Record<string, number>; lifecycle: Record<string, number>; total: number }
export interface MergedMatrix { rows: MergedRow[]; valueTotals: Record<string, number>; lifecycleTotals: Record<string, number>; grandTotal: number }
export interface TreeCell { value: string; lifecycle: string; count: number }
export interface WbData {
  kpis: WbKpis;
  valueCols: string[]; lifecycleCols: string[];
  matrix: MergedMatrix;      // one merged Store × (Value | Lifecycle) table
  tree: TreeCell[];          // 9 Value×Lifecycle counts (the KPI cross-tab)
  valueDist: WbBar[];        // donut: value share
  lifecycleDist: WbBar[];    // donut: lifecycle share
  cropBreakdown: WbBar[];
  extra: WbBar[]; // sales: FY spend-tier dist ; visit: problem dist
  extraTitle: string;
  secondary: WbBar[]; // sales: top zones by FY spend ; visit: officer activity
  secondaryTitle: string;
}

const EMPTY_WB: WbData = {
  kpis: { farmers: 0, spend: 0, visits: 0 },
  valueCols: [...VALUE_SEGMENTS], lifecycleCols: [...LIFECYCLE_SEGMENTS],
  matrix: { rows: [], valueTotals: {}, lifecycleTotals: {}, grandTotal: 0 },
  tree: [], valueDist: [], lifecycleDist: [], cropBreakdown: [], extra: [], extraTitle: "", secondary: [], secondaryTitle: "",
};

export async function getWorkbench(f: WbFilters): Promise<WbData> {
  const scoped = await scopeFilters(f);
  if (scoped === "none") return EMPTY_WB; // scoped user with no store/region → nothing to show
  f = scoped;
  const stores = await prisma.store.findMany({ select: { id: true, name: true } });
  const nameById = new Map(stores.map((s) => [s.id, shortStore(s.name)]));

  // ── Visit lens: purely field-visit data (no FY segmentation). ──
  if (f.lens === "visit") {
    const whereF = whereOf(f, "f");
    const [cntRows, vr, cropRows, probRows, offRows] = await Promise.all([
      prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int n FROM "Farmer" f ${whereF}`),
      prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int n FROM "Visit" v JOIN "Farmer" f ON f.id = v."farmerId" ${whereF}`),
      prisma.$queryRaw<{ crop: string; n: number }[]>(Prisma.sql`SELECT unnest(f."visitCropTags") crop, COUNT(*)::int n FROM "Farmer" f ${whereF} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`),
      prisma.$queryRaw<{ problem: string; n: number }[]>(Prisma.sql`
        SELECT unnest(v."currentProblem") problem, COUNT(DISTINCT v."farmerId")::int n FROM "Visit" v JOIN "Farmer" f ON f.id=v."farmerId" ${whereF}
        AND array_length(v."currentProblem",1) > 0 GROUP BY 1 ORDER BY 2 DESC LIMIT 12`),
      prisma.$queryRaw<{ officer: string; n: number }[]>(Prisma.sql`
        SELECT v."officerName" officer, COUNT(*)::int n FROM "Visit" v JOIN "Farmer" f ON f.id=v."farmerId" ${whereF}
        AND v."officerName" IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    ]);
    return {
      kpis: { farmers: num(cntRows[0]?.n), spend: 0, visits: num(vr[0]?.n) },
      valueCols: [...VALUE_SEGMENTS], lifecycleCols: [...LIFECYCLE_SEGMENTS],
      matrix: { rows: [], valueTotals: {}, lifecycleTotals: {}, grandTotal: 0 }, tree: [], valueDist: [], lifecycleDist: [],
      cropBreakdown: cropRows.map((r) => ({ label: r.crop, value: num(r.n) })),
      extra: probRows.map((r) => ({ label: r.problem, value: num(r.n) })), extraTitle: "Field problems (farmers)",
      secondary: offRows.map((r) => ({ label: r.officer, value: num(r.n) })), secondaryTitle: "Officer visit activity",
    };
  }

  // ── Sales lens: FY-dynamic value×lifecycle (tiers computed live from Sale within the selected FY). ──
  const cte = tiersCte(f), tf = tierFilter(f);
  const [cross, histRows, zoneRows, cropRows] = await Promise.all([
    prisma.$queryRaw<{ storeId: number | null; vseg: string; lseg: string; n: number; spendsum: bigint }[]>(Prisma.sql`
      WITH ${cte} SELECT "storeId", vseg, lseg, COUNT(*)::int n, COALESCE(SUM(spend),0)::bigint spendsum FROM tiers WHERE ${tf} GROUP BY 1,2,3`),
    prisma.$queryRaw<{ bucket: string; n: number }[]>(Prisma.sql`
      WITH ${cte} SELECT CASE WHEN spend>=12000 THEN 'HNI ₹12K+' WHEN spend>=10000 THEN '₹10–12K' WHEN spend>=5000 THEN '₹5–10K'
        WHEN spend>=2500 THEN '₹2.5–5K' WHEN spend>0 THEN '< ₹2.5K' ELSE 'No spend' END bucket, COUNT(*)::int n FROM tiers WHERE ${tf} GROUP BY 1`),
    prisma.$queryRaw<{ zone: string; spend: bigint }[]>(Prisma.sql`
      WITH ${cte} SELECT "zone" AS zone, COALESCE(SUM(spend),0)::bigint spend FROM tiers WHERE ${tf} AND "zone" IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    prisma.$queryRaw<{ crop: string; n: number }[]>(Prisma.sql`
      WITH ${cte} SELECT unnest(f."salesCropTags") crop, COUNT(*)::int n FROM tiers t JOIN "Farmer" f ON f.id=t.id WHERE ${tf} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`),
  ]);

  const byStore = new Map<number | null, { value: Record<string, number>; lifecycle: Record<string, number>; total: number }>();
  const valueTotals: Record<string, number> = {}, lifecycleTotals: Record<string, number> = {};
  const treeMap = new Map<string, number>();
  let farmers = 0, spendTotal = 0;
  for (const r of cross) {
    const cnt = num(r.n);
    const st = byStore.get(r.storeId) ?? { value: {}, lifecycle: {}, total: 0 };
    st.value[r.vseg] = (st.value[r.vseg] ?? 0) + cnt;
    st.lifecycle[r.lseg] = (st.lifecycle[r.lseg] ?? 0) + cnt;
    st.total += cnt; byStore.set(r.storeId, st);
    valueTotals[r.vseg] = (valueTotals[r.vseg] ?? 0) + cnt;
    lifecycleTotals[r.lseg] = (lifecycleTotals[r.lseg] ?? 0) + cnt;
    treeMap.set(`${r.vseg}|${r.lseg}`, (treeMap.get(`${r.vseg}|${r.lseg}`) ?? 0) + cnt);
    farmers += cnt; spendTotal += Number(r.spendsum);
  }
  const rows: MergedRow[] = [...byStore.entries()].map(([storeId, s]) => ({
    storeId, storeName: storeId == null ? "Unassigned" : nameById.get(storeId) ?? `Store #${storeId}`,
    value: s.value, lifecycle: s.lifecycle, total: s.total,
  })).sort((a, b) => b.total - a.total).slice(0, 100);
  const tree = VALUE_SEGMENTS.flatMap((v) => LIFECYCLE_SEGMENTS.map((l) => ({ value: v, lifecycle: l, count: treeMap.get(`${v}|${l}`) ?? 0 })));
  const order = ["HNI ₹12K+", "₹10–12K", "₹5–10K", "₹2.5–5K", "< ₹2.5K", "No spend"];

  return {
    kpis: { farmers, spend: spendTotal, visits: 0 },
    valueCols: [...VALUE_SEGMENTS], lifecycleCols: [...LIFECYCLE_SEGMENTS],
    matrix: { rows, valueTotals, lifecycleTotals, grandTotal: farmers },
    tree,
    valueDist: VALUE_SEGMENTS.map((s) => ({ label: segMeta(s).label, value: valueTotals[s] ?? 0, color: segMeta(s).color })),
    lifecycleDist: LIFECYCLE_SEGMENTS.map((s) => ({ label: segMeta(s).label, value: lifecycleTotals[s] ?? 0, color: segMeta(s).color })),
    cropBreakdown: cropRows.map((r) => ({ label: r.crop, value: num(r.n) })),
    extra: histRows.map((r) => ({ label: r.bucket, value: num(r.n) })).sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label)),
    extraTitle: "Spend tiers (FY)",
    secondary: zoneRows.map((r) => ({ label: r.zone, value: Number(r.spend) })), secondaryTitle: "Top zones by FY spend",
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
export type SegDim = "value" | "lifecycle";
export async function getWorkbenchCustomers(f: WbFilters, storeId: number | null, dim: SegDim, seg: string, limit = 400): Promise<WbCustomer[]> {
  // Scope LAST (after applying the clicked cell's store) so an officer/RM can't drill into a foreign store.
  const scoped = await scopeFilters({ ...f, storeIds: storeId != null ? [storeId] : undefined });
  if (scoped === "none") return [];
  const cte = tiersCte(scoped), tf = tierFilter(scoped);
  const dimCond = dim === "value" ? Prisma.sql`t.vseg = ${seg}` : Prisma.sql`t.lseg = ${seg}`;
  const storeCond = storeId == null ? Prisma.sql`t."storeId" IS NULL` : Prisma.sql`t."storeId" = ${storeId}`;
  const rows = await prisma.$queryRaw<{ id: number; name: string; mobile: string | null; village: string | null; spend: bigint; vseg: string | null; lseg: string | null; salesc: string[]; visitc: string[] }[]>(Prisma.sql`
    WITH ${cte}
    SELECT f.id, f.name, f.mobile, f.village, t.spend, t.vseg, t.lseg, f."salesCropTags" salesc, f."visitCropTags" visitc
    FROM tiers t JOIN "Farmer" f ON f.id = t.id
    WHERE ${tf} AND ${storeCond} AND ${dimCond}
    ORDER BY t.spend DESC NULLS LAST LIMIT ${limit}`);
  return rows.map((r) => ({
    id: r.id, name: r.name, mobile: r.mobile, village: r.village,
    spend: r.spend != null ? inr(Number(r.spend)) : "—",
    segment: [r.vseg, r.lseg].filter(Boolean).map((s) => segMeta(s!).label).join(" · ") || "—",
    salesCrops: r.salesc ?? [], visitCrops: r.visitc ?? [],
  }));
}

/* ── Export the workbench Segment × Store table + the full filtered farmer list to Excel ── */
const FARMER_EXPORT_CAP = 200000; // covers the whole REAL farmer base; the note row fires only past it

export async function exportWorkbookXlsx(f: WbFilters): Promise<{ ok: boolean; filename?: string; b64?: string; error?: string }> {
  const scoped = await scopeFilters(f);
  if (scoped === "none") return { ok: false, error: "No store or region is assigned to your account." };
  const cte = tiersCte(scoped), tf = tierFilter(scoped);

  const [cross, stores, farmerRows] = await Promise.all([
    prisma.$queryRaw<{ storeId: number | null; vseg: string; lseg: string; n: number }[]>(Prisma.sql`
      WITH ${cte} SELECT "storeId", vseg, lseg, COUNT(*)::int n FROM tiers WHERE ${tf} GROUP BY 1,2,3`),
    prisma.store.findMany({ select: { id: true, name: true } }),
    prisma.$queryRaw<{ name: string; mobile: string | null; village: string | null; zone: string | null; storeId: number | null; vseg: string | null; lseg: string | null; spend: bigint; salesc: string[]; visitc: string[]; pests: string[] }[]>(Prisma.sql`
      WITH ${cte} SELECT f.name, f.mobile, f.village, f."zone" AS zone, t."storeId" AS "storeId", t.vseg, t.lseg, t.spend,
        f."salesCropTags" salesc, f."visitCropTags" visitc, f."pestTags" pests
      FROM tiers t JOIN "Farmer" f ON f.id=t.id WHERE ${tf} ORDER BY t.spend DESC NULLS LAST LIMIT ${FARMER_EXPORT_CAP}`),
  ]);

  const nameById = new Map(stores.map((s) => [s.id, shortStore(s.name)]));
  const V = [...VALUE_SEGMENTS], L = [...LIFECYCLE_SEGMENTS];
  const byStore = new Map<number | null, { value: Record<string, number>; lifecycle: Record<string, number>; total: number }>();
  const valueTotals: Record<string, number> = {}, lifecycleTotals: Record<string, number> = {};
  let grand = 0;
  for (const r of cross) {
    const cnt = num(r.n);
    const st = byStore.get(r.storeId) ?? { value: {}, lifecycle: {}, total: 0 };
    st.value[r.vseg] = (st.value[r.vseg] ?? 0) + cnt; st.lifecycle[r.lseg] = (st.lifecycle[r.lseg] ?? 0) + cnt; st.total += cnt;
    byStore.set(r.storeId, st);
    valueTotals[r.vseg] = (valueTotals[r.vseg] ?? 0) + cnt; lifecycleTotals[r.lseg] = (lifecycleTotals[r.lseg] ?? 0) + cnt; grand += cnt;
  }
  const rows = [...byStore.entries()].map(([storeId, s]) => ({
    storeName: storeId == null ? "Unassigned" : nameById.get(storeId) ?? `Store #${storeId}`, ...s,
  })).sort((a, b) => b.total - a.total).slice(0, 100);

  const mergedSheet: (string | number)[][] = [
    ["Store", ...V.map((s) => segMeta(s).label), "Segment Total", ...L.map((s) => segMeta(s).label), "Any Spend Total"],
    ["All stores", ...V.map((s) => valueTotals[s] ?? 0), grand, ...L.map((s) => lifecycleTotals[s] ?? 0), grand],
    ...rows.map((r) => [r.storeName, ...V.map((s) => r.value[s] ?? 0), r.total, ...L.map((s) => r.lifecycle[s] ?? 0), r.total]),
  ];
  const farmerSheet: (string | number)[][] = [
    ["Farmer", "Mobile", "Store", "Region", "Village", "Value segment", "Lifecycle", "FY Spend (₹)", "Sales crops", "Visit crops", "Target pests / diseases"],
    ...farmerRows.map((r) => [
      r.name, r.mobile ?? "", r.storeId != null ? nameById.get(r.storeId) ?? "" : "", r.zone ?? "", r.village ?? "",
      r.vseg ? segMeta(r.vseg).label : "—", r.lseg ? segMeta(r.lseg).label : "—", Number(r.spend ?? 0),
      (r.salesc ?? []).map(cropLabel).join(", "), (r.visitc ?? []).map(cropLabel).join(", "), (r.pests ?? []).map(tagLabel).join(", "),
    ]),
  ];
  if (farmerRows.length >= FARMER_EXPORT_CAP) {
    farmerSheet.push([`Note: list capped at ${FARMER_EXPORT_CAP.toLocaleString("en-IN")} farmers (by FY spend). Narrow the filters for a complete set.`]);
  }

  const b64 = buildWorkbookB64([
    { name: "Value + Lifecycle x Store", rows: mergedSheet },
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
export async function getCropTrend(crops: string[]): Promise<CropTrendPoint[]> {
  const safe = (crops ?? []).map((c) => (c || "").toLowerCase().replace(/[^a-z_]/g, "")).filter(Boolean);
  const { role, storeId, zone } = await getScope();
  const scopeSql: Prisma.Sql =
    role === "officer"
      ? storeId != null ? Prisma.sql`AND sl."storeId" = ${storeId}` : Prisma.sql`AND false`
      : role === "regional"
        ? zone != null
          ? Prisma.sql`AND EXISTS (SELECT 1 FROM "Store" st WHERE st.id = sl."storeId" AND st."zone" = ${zone})`
          : Prisma.sql`AND false`
        : Prisma.empty;
  const cropCond = safe.length ? Prisma.sql`sl."cropTag" = ANY(${safe}) AND ` : Prisma.empty;
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
  const tier = f.lens === "sales" && f.spendTiers?.length ? SPEND_TIERS[f.spendTiers[0]] : undefined;
  const criteria: ClusterCriteria = {
    storeIds: f.storeIds?.length ? f.storeIds : undefined,
    zones: f.zones?.length ? f.zones : undefined,
    valueSegments: f.valueSegments?.length ? f.valueSegments : undefined,
    lifecycleSegments: f.lifecycleSegments?.length ? f.lifecycleSegments : undefined,
    salesCrops: f.lens === "sales" && f.crops?.length ? f.crops : undefined,
    visitCrops: f.lens === "visit" && f.crops?.length ? f.crops : undefined,
    pestTags: f.pests?.length ? f.pests : undefined,
    visitProblem: f.lens === "visit" && f.problems?.length ? f.problems[0] : undefined,
    spendMin: tier?.min, spendMax: tier?.max,
  };
  return createClusterFromCriteria({ name, criteria, origin: "analytics", mode: "dynamic" });
}
