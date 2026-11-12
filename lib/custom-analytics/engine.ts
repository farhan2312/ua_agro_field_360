/**
 * Custom analytics — query engine. Turns one visual (+ page filters + click-to-filter) into a single
 * aggregate SQL query over the semantic model, ALWAYS restricted to the viewer's own scope.
 *
 * Safety: every SQL fragment comes from the constant model in sql.ts, chosen by id after validation
 * against model.ts. User-supplied values (dates, stores, segments, clicked values, top-N keys) are only
 * ever bound parameters ($n). Plain module — server only.
 */
import { prisma } from "@/lib/prisma";
import type { Scope } from "@/lib/scope";
import { startOfToday } from "@/lib/action-constants";
import { SQL, type DatasetSql } from "./sql";
import { DATASET_BY_ID, fieldMeta, aggsFor, FILTER_SUPPORT, type FieldMeta } from "./model";
import type { Visual, PageFilters, CrossFilter, FieldRef, ValueRef, VisualResult, DateGrain, Agg } from "./types";

/** Bound-parameter collector → "$1", "$2"… */
class Params {
  list: unknown[] = [];
  p(v: unknown, cast = ""): string { this.list.push(v); return `$${this.list.length}${cast}`; }
}

const OTHER = "Other";
const MAX_DATE_POINTS = 500;
const TABLE_PAGE = 50;
const EXPORT_CAP = 50_000;

/** Store ids the viewer may see: null = everything, "none" = nothing (fail closed). */
export function scopeStoreIds(scope: Scope): number[] | null | "none" {
  if (scope.role === "campaigner") return "none";
  if (scope.role === "officer") return scope.storeId != null ? [scope.storeId] : "none";
  if (scope.role === "regional") return scope.managedStoreIds && scope.managedStoreIds.length ? scope.managedStoreIds : "none";
  return null;
}

const ist = (x: string) => `(${x} + interval '330 minutes')`;
function grainExpr(x: string, g: DateGrain): string {
  const t = ist(x);
  switch (g) {
    case "day": return `to_char(${t}, 'YYYY-MM-DD')`;
    case "week": return `to_char(date_trunc('week', ${t}), 'YYYY-MM-DD')`;
    case "month": return `to_char(${t}, 'YYYY-MM')`;
    case "quarter": return `to_char(${t}, 'YYYY-"Q"Q')`;
    case "year": return `to_char(${t}, 'YYYY')`;
    case "fy": return `('FY' || to_char(${t} - interval '3 months', 'YY') || '-' || to_char(${t} + interval '9 months', 'YY'))`;
  }
}

/** IST calendar maths for the page date presets → [from, to) as UTC instants. */
export function dateRange(f: PageFilters): { from?: Date; to?: Date } {
  const preset = f.datePreset ?? "all";
  if (preset === "all") return {};
  const IST = 330 * 60_000;
  const nowIst = new Date(Date.now() + IST);
  const y = nowIst.getUTCFullYear(), mo = nowIst.getUTCMonth(), day = nowIst.getUTCDate();
  const at = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm, dd) - IST); // IST midnight
  const tomorrow = at(y, mo, day + 1);
  const fyStartYear = mo >= 3 ? y : y - 1;
  switch (preset) {
    case "30d": return { from: at(y, mo, day - 29), to: tomorrow };
    case "90d": return { from: at(y, mo, day - 89), to: tomorrow };
    case "thisMonth": return { from: at(y, mo, 1), to: tomorrow };
    case "lastMonth": return { from: at(y, mo - 1, 1), to: at(y, mo, 1) };
    case "thisFy": return { from: at(fyStartYear, 3, 1), to: tomorrow };
    case "lastFy": return { from: at(fyStartYear - 1, 3, 1), to: at(fyStartYear, 3, 1) };
    case "custom": {
      const p = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split("-").map(Number) : null);
      const a = p(f.dateFrom), b = p(f.dateTo);
      return { from: a ? at(a[0], a[1] - 1, a[2]) : undefined, to: b ? at(b[0], b[1] - 1, b[2] + 1) : undefined };
    }
  }
  return {};
}

interface Built { from: string; where: string; ignored: string[] }

/** A field usable as a dimension in this dataset (dims, and — for tables — numeric columns too). */
function dimField(ds: string, ref: FieldRef | null | undefined): FieldMeta | null {
  if (!ref) return null;
  const f = fieldMeta(ds, ref.field);
  return f && f.kind !== "measure" ? f : null;
}

const GRAINS: DateGrain[] = ["day", "week", "month", "quarter", "year", "fy"];

function dimSql(def: DatasetSql, ds: string, ref: FieldRef, laterals: Set<string>): string {
  const meta = fieldMeta(ds, ref.field)!;
  const fd = def.fields[ref.field];
  if (fd.lateral) laterals.add(fd.lateral);
  if (meta.date) return grainExpr(fd.expr, ref.grain && GRAINS.includes(ref.grain) ? ref.grain : "month"); // allow-listed
  return `(${fd.expr})::text`;
}

function valueSql(def: DatasetSql, ds: string, v: ValueRef, laterals: Set<string>): string {
  const meta = fieldMeta(ds, v.field)!;
  if (meta.kind === "measure") return def.measures[v.field];
  const fd = def.fields[v.field];
  if (fd.lateral) laterals.add(fd.lateral);
  const agg: Agg = v.agg && aggsFor(meta).includes(v.agg) ? v.agg : meta.kind === "num" ? meta.defaultAgg ?? "sum" : "distinct";
  switch (agg) {
    case "sum": return `COALESCE(SUM(${fd.expr}), 0)`;
    case "avg": return `AVG(${fd.expr})`;
    case "min": return `MIN(${fd.expr})`;
    case "max": return `MAX(${fd.expr})`;
    case "count": return `COUNT(${fd.expr})`;
    case "distinct": return `COUNT(DISTINCT ${fd.expr})`;
  }
}

function buildBase(ds: string, def: DatasetSql, scope: Scope, f: PageFilters, cf: CrossFilter | null, q: Params, laterals: Set<string>): Built {
  const where = [...def.where];
  const ignored: string[] = [];
  const sup = FILTER_SUPPORT[ds];

  const ids = scopeStoreIds(scope);
  if (ids === "none") where.push("false");
  else if (ids) where.push(`${def.storeCol} = ANY(${q.p(ids, "::int[]")})`);

  const strs = (a: unknown): string[] => (Array.isArray(a) ? a.filter((x): x is string => typeof x === "string").slice(0, 500) : []);
  const storeIds = Array.isArray(f.storeIds) ? f.storeIds.map(Number).filter(Number.isInteger).slice(0, 500) : [];
  const regions = strs(f.regions), rms = strs(f.rms), vsegs = strs(f.valueSegments), lsegs = strs(f.lifecycles);
  if (storeIds.length) where.push(`${def.storeCol} = ANY(${q.p(storeIds, "::int[]")})`);
  if (regions.length) where.push(`s.zone = ANY(${q.p(regions, "::text[]")})`);
  if (rms.length) where.push(`btrim(s."regionalManager") = ANY(${q.p(rms, "::text[]")})`);
  if (vsegs.length) {
    if (sup.valueSegment && def.valueSegment) where.push(`${def.valueSegment} = ANY(${q.p(vsegs, "::text[]")})`);
    else ignored.push("Value segment");
  }
  if (lsegs.length) {
    if (sup.lifecycle && def.lifecycle) where.push(`${def.lifecycle} = ANY(${q.p(lsegs, "::text[]")})`);
    else ignored.push("Lifecycle");
  }
  const r = dateRange(f);
  if (r.from || r.to) {
    if (def.date) {
      if (r.from) where.push(`${def.date} >= ${q.p(r.from, "::timestamp")}`);
      if (r.to) where.push(`${def.date} < ${q.p(r.to, "::timestamp")}`);
    } else ignored.push("Date");
  }

  // Click-to-filter: the same field on the same dataset, or a shared (common) field on any dataset.
  if (cf && typeof cf.value === "string" && typeof cf.field === "string" && cf.value !== OTHER) {
    let ref: FieldRef | null = null;
    if (cf.dataset === ds && fieldMeta(ds, cf.field)) ref = { field: cf.field, grain: cf.grain };
    else if (cf.common) {
      const match = DATASET_BY_ID[ds].fields.find((x) => x.common === cf.common && x.kind === "dim");
      if (match) ref = { field: match.id };
    }
    if (ref) where.push(`${dimSql(def, ds, ref, laterals)} = ${q.p(cf.value)}`);
  }

  return { from: def.from, where: where.length ? `WHERE ${where.join(" AND ")}` : "", ignored };
}

async function run<T>(sql: string, params: unknown[]): Promise<T[]> {
  const [, rows] = await prisma.$transaction([
    prisma.$executeRawUnsafe(`SET LOCAL statement_timeout = 25000`),
    prisma.$queryRawUnsafe<T[]>(sql, ...params),
  ]);
  return rows;
}

const toNum = (x: unknown): number | null => (x == null ? null : typeof x === "number" ? x : typeof x === "bigint" ? Number(x) : Number(x as string));

/** Which dims a visual groups by, its values, and the category cap per dim. */
function shape(v: Visual): { dims: FieldRef[]; caps: (number | null)[]; values: ValueRef[] } {
  // topN arrives from the browser and ends up in LIMIT — always a clamped integer, never raw input.
  const top = (dflt: number, max = 50) => Math.max(3, Math.min(max, Math.floor(Number(v.topN) || dflt)));
  const vals = Array.isArray(v.values) ? v.values : [];
  const axis = v.axis ? [v.axis] : [];
  switch (v.type) {
    case "kpi": return { dims: [], caps: [], values: vals.slice(0, 1) };
    case "table": return { dims: (Array.isArray(v.dims) ? v.dims : []).slice(0, 4), caps: [], values: vals.slice(0, 6) };
    case "matrix": return { dims: [v.axis, v.split].filter(Boolean) as FieldRef[], caps: [top(50, 200), 12], values: vals.slice(0, 1) };
    case "donut": return { dims: axis, caps: [top(8)], values: vals.slice(0, 1) };
    case "treemap": return { dims: axis, caps: [top(30)], values: vals.slice(0, 1) };
    default: {
      const dims = [v.axis, v.split].filter(Boolean) as FieldRef[];
      return { dims, caps: [top(15), 8], values: v.split ? vals.slice(0, 1) : vals.slice(0, 4) };
    }
  }
}

export interface RunOpts { page?: number; sortKey?: string; sortDir?: "asc" | "desc"; exportAll?: boolean }

export async function runVisual(scope: Scope, v: Visual, filters: PageFilters, cf: CrossFilter | null, opts: RunOpts = {}): Promise<VisualResult> {
  const ds = v.dataset;
  if (!ds || !SQL[ds] || !DATASET_BY_ID[ds]) return { ok: false, error: "Add a field from the Data panel to start.", rows: [] };
  const def = SQL[ds];
  const { dims, caps, values } = shape(v);

  // Validate every field against the model (unknown ids are rejected, never interpolated).
  for (const d of dims) if (!d || typeof d.field !== "string" || !dimField(ds, d)) return { ok: false, error: "Unknown field on this visual.", rows: [] };
  for (const x of values) if (!x || typeof x.field !== "string" || !fieldMeta(ds, x.field)) return { ok: false, error: "Unknown value on this visual.", rows: [] };
  if (v.type !== "table" && !values.length) return { ok: false, error: "Add a value (a number to show).", rows: [] };
  if (v.type === "table" && !values.length && !dims.length) return { ok: false, error: "Add fields to the table.", rows: [] };
  if (v.type === "matrix" && dims.length < 2) return { ok: false, error: "A matrix needs Rows and Columns.", rows: [] };
  if (["column", "bar", "line", "area", "donut", "treemap"].includes(v.type) && !dims.length) return { ok: false, error: "Add a field to the axis.", rows: [] };

  const isDate = dims.map((d) => !!fieldMeta(ds, d.field)?.date);

  /** Build every SQL piece with a FRESH parameter list (Postgres rejects bound params a query doesn't use). */
  const prep = (foldKeys: (string[] | null)[] = []) => {
    const q = new Params();
    const laterals = new Set<string>();
    const base = buildBase(ds, def, scope, filters, cf, q, laterals);
    const dimExprs = dims.map((d) => dimSql(def, ds, d, laterals));
    const valExprs = values.map((x) => valueSql(def, ds, x, laterals));
    const folded = dimExprs.map((e, i) => (foldKeys[i] ? `CASE WHEN ${e} = ANY(${q.p(foldKeys[i], "::text[]")}) THEN ${e} ELSE '${OTHER}' END` : e));
    const from = `${base.from} ${[...laterals].join(" ")}`;
    const finish = (sql: string) => (sql.includes(":today") ? sql.replaceAll(":today", q.p(startOfToday(), "::timestamp")) : sql);
    return { q, base, dimExprs, valExprs, folded, from, finish };
  };

  try {
    // Fold long category lists into "Other" (top N by the first value). Date axes are never folded;
    // a full table export is never folded.
    let truncated = false;
    const foldKeys: (string[] | null)[] = dims.map(() => null);
    if (!(opts.exportAll && v.type === "table")) {
      for (let i = 0; i < dims.length; i++) {
        const cap = caps[i];
        if (cap == null || isDate[i]) continue;
        const P = prep();
        const primary = P.valExprs[0] ?? "COUNT(*)";
        const top = await run<{ k: string | null }>(P.finish(`SELECT ${P.dimExprs[i]} AS k FROM ${P.from} ${P.base.where} GROUP BY 1 ORDER BY ${primary} DESC NULLS LAST LIMIT ${cap + 1}`), P.q.list);
        if (top.length > cap) { truncated = true; foldKeys[i] = top.slice(0, cap).map((t) => t.k ?? ""); }
      }
    }

    const P = prep(foldKeys);
    const sel = [...P.folded.map((e, i) => `${e} AS d${i}`), ...P.valExprs.map((e, i) => `${e} AS m${i}`)];

    if (v.type === "matrix") {
      const [a, b] = P.folded;
      const sql = `SELECT ${sel.join(", ")}, GROUPING(${a}) AS g0, GROUPING(${b}) AS g1 FROM ${P.from} ${P.base.where}
        GROUP BY GROUPING SETS ((${a}, ${b}), (${a}), (${b}), ())`;
      const rows = await run<Record<string, unknown>>(P.finish(sql), P.q.list);
      return {
        ok: true, truncated, ignoredFilters: P.base.ignored,
        rows: rows.map((r) => ({ d0: Number(r.g0) === 1 ? "__total" : (r.d0 as string | null), d1: Number(r.g1) === 1 ? "__total" : (r.d1 as string | null), m0: toNum(r.m0) })),
      };
    }

    if (v.type === "table") {
      const keys = [...dims.map((_, i) => `d${i}`), ...values.map((_, i) => `m${i}`)];
      const sortKey = opts.sortKey && keys.includes(opts.sortKey) ? opts.sortKey : values.length ? "m0" : "d0";
      const dir = opts.sortDir === "asc" ? "ASC" : "DESC";
      const page = Math.max(0, Math.min(100_000, Math.floor(Number(opts.page) || 0)));
      const limit = opts.exportAll ? EXPORT_CAP : TABLE_PAGE;
      const group = dims.length ? `GROUP BY ${dims.map((_, i) => i + 1).join(", ")}` : "";
      const sql = `SELECT ${sel.join(", ")}, COUNT(*) OVER () AS __total FROM ${P.from} ${P.base.where} ${group}
        ORDER BY ${sortKey} ${dir} NULLS LAST LIMIT ${limit} OFFSET ${opts.exportAll ? 0 : page * TABLE_PAGE}`;
      const rows = await run<Record<string, unknown>>(P.finish(sql), P.q.list);
      return { ok: true, ignoredFilters: P.base.ignored, total: rows.length ? toNum(rows[0].__total) ?? 0 : 0, rows: rows.map((r) => clean(r, dims.length, values.length)) };
    }

    // KPI + charts. Wrapped so the outer ORDER BY can use the output names (Other last).
    const group = dims.length ? `GROUP BY ${dims.map((_, i) => i + 1).join(", ")}` : "";
    const inner = `SELECT ${sel.join(", ")} FROM ${P.from} ${P.base.where} ${group}`;
    const order = !dims.length ? "" : isDate[0] ? "ORDER BY d0 ASC" : `ORDER BY (d0 = '${OTHER}'), m0 DESC NULLS LAST`;
    const limit = dims.length && isDate[0] ? `LIMIT ${MAX_DATE_POINTS * (dims.length > 1 ? 9 : 1)}` : "";
    const rows = await run<Record<string, unknown>>(P.finish(`SELECT * FROM (${inner}) t ${order} ${limit}`), P.q.list);
    return { ok: true, truncated, ignoredFilters: P.base.ignored, rows: rows.map((r) => clean(r, dims.length, values.length)) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: /statement timeout|canceling statement/i.test(msg) ? "This visual took too long — add a filter or pick fewer categories." : "Couldn’t load this visual.", rows: [] };
  }
}

function clean(r: Record<string, unknown>, nd: number, nv: number): Record<string, string | number | null> {
  const o: Record<string, string | number | null> = {};
  for (let i = 0; i < nd; i++) o[`d${i}`] = (r[`d${i}`] as string | null) ?? null;
  for (let i = 0; i < nv; i++) o[`m${i}`] = toNum(r[`m${i}`]);
  return o;
}
