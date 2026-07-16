"use server";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { SEGMENT_COLUMNS, segMeta } from "@/lib/campaign-segments";
import { inr } from "@/lib/format";
import { createClusterFromCriteria } from "@/app/actions/cluster-builder";
import type { ClusterCriteria } from "@/lib/cluster-rules";
import { getScope } from "@/lib/scope";

export type Lens = "sales" | "visit";

export interface WbFilters {
  lens: Lens;
  storeId?: number | null;
  zone?: string;
  crop?: string; // matched against sales or visit crops depending on lens
  segment?: string; // campaignSegment
  spendTier?: number | null; // index into SPEND_TIERS (sales lens)
  problem?: string; // visit lens
}

const SPEND_TIERS: { label: string; min?: number; max?: number }[] = [
  { label: "HNI · ₹12K+", min: 12000 },
  { label: "₹10–12K", min: 10000, max: 12000 },
  { label: "₹5–10K", min: 5000, max: 10000 },
  { label: "₹2.5–5K", min: 2500, max: 5000 },
  { label: "< ₹2.5K", max: 2500 },
];

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
  problems: { problem: string; count: number }[];
  spendTiers: string[];
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

  const [stores, zoneRows, sc, vc, pr] = await Promise.all([
    prisma.store.findMany({ where: storeWhere, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    isOfficer || isRM
      ? Promise.resolve([] as { zone: string | null }[])
      : prisma.farmer.findMany({ where: { zone: { not: null }, source: "REAL" }, distinct: ["zone"], select: { zone: true }, orderBy: { zone: "asc" } }),
    prisma.$queryRaw<{ crop: string; n: number }[]>(Prisma.sql`SELECT unnest("salesCropTags") crop, COUNT(*)::int n FROM "Farmer" WHERE source='REAL' AND ${fScope} GROUP BY 1 ORDER BY 2 DESC`),
    prisma.$queryRaw<{ crop: string; n: number }[]>(Prisma.sql`SELECT unnest("visitCropTags") crop, COUNT(*)::int n FROM "Farmer" WHERE source='REAL' AND ${fScope} GROUP BY 1 ORDER BY 2 DESC`),
    prisma.$queryRaw<{ problem: string; n: number }[]>(Prisma.sql`SELECT unnest(v."currentProblem") problem, COUNT(*)::int n FROM "Visit" v JOIN "Farmer" f ON f.id = v."farmerId" WHERE array_length(v."currentProblem",1) > 0 AND ${vScope} GROUP BY 1 ORDER BY 2 DESC LIMIT 40`),
  ]);
  const zones = isRM ? (zone != null ? [zone] : []) : isOfficer ? [] : zoneRows.map((z) => z.zone!).filter(Boolean);
  return {
    stores: stores.map((s) => ({ id: s.id, name: shortStore(s.name) })),
    zones,
    salesCrops: sc.map((r) => ({ crop: r.crop, count: num(r.n) })),
    visitCrops: vc.map((r) => ({ crop: r.crop, count: num(r.n) })),
    problems: pr.map((r) => ({ problem: r.problem, count: num(r.n) })),
    spendTiers: SPEND_TIERS.map((t) => t.label),
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

/* ── Save the current filter as a live dynamic segment ── */
export async function saveWorkbenchSegment(f: WbFilters, name: string): Promise<{ ok: boolean; error?: string }> {
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
    visitProblem: f.lens === "visit" ? f.problem || undefined : undefined,
    spendMin: tier?.min, spendMax: tier?.max,
  };
  return createClusterFromCriteria({ name, criteria, origin: "analytics", mode: "dynamic" });
}
