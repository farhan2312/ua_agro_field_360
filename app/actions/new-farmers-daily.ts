"use server";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getScope } from "@/lib/scope";
import { shortStoreName } from "@/lib/store-utils";
import { cropLabel } from "@/lib/crops";
import { locVal } from "@/lib/campaign-location";
import { VALUE_HNI_MIN, VALUE_POTENTIAL_MIN } from "@/lib/campaign-segments";
import { originOf, ORIGIN_LABEL, ORIGIN_SQL_CASE, type OriginKey } from "@/lib/farmer-origin";
import { buildStyledWorkbookB64 } from "@/lib/xlsx-styled";

/* New farmers added per day (IST) — who they are, where they're from, their customer status and how
   they came in (ERP sync from a store bill, field visit, Excel upload). Role-scoped by the farmer's store. */

const IST_MS = 330 * 60_000;

async function scopeSql(): Promise<Prisma.Sql | null> {
  const { role, storeId, managedStoreIds } = await getScope();
  if (role === "campaigner") return null;
  if (role === "officer") return storeId != null ? Prisma.sql`AND f."storeId" = ${storeId}` : null;
  if (role === "regional") return managedStoreIds?.length ? Prisma.sql`AND f."storeId" = ANY(${managedStoreIds})` : null;
  return Prisma.empty;
}

export interface NfDayCount { date: string; total: number; erp: number; visit: number; import: number; other: number }

/** Farmers added per IST day over the last `days` days (newest first), split by how they came. */
export async function getNewFarmerDays(days = 60): Promise<NfDayCount[]> {
  const scope = await scopeSql();
  if (!scope) return [];
  const since = new Date(Date.now() - days * 864e5);
  const rows = await prisma.$queryRaw<{ d: string; m: string; n: number }[]>(Prisma.sql`
    SELECT to_char((f."createdAt" + interval '330 minutes')::date, 'YYYY-MM-DD') d, ${Prisma.raw(ORIGIN_SQL_CASE)} m, COUNT(*)::int n
    FROM "Farmer" f
    WHERE f.source = 'REAL' AND f."createdAt" >= ${since} ${scope}
    GROUP BY 1, 2`);
  const by = new Map<string, NfDayCount>();
  for (const r of rows) {
    const e = by.get(r.d) ?? by.set(r.d, { date: r.d, total: 0, erp: 0, visit: 0, import: 0, other: 0 }).get(r.d)!;
    e.total += r.n;
    if (r.m === "ERP") e.erp += r.n; else if (r.m === "VISIT") e.visit += r.n; else if (r.m === "IMPORT") e.import += r.n; else e.other += r.n;
  }
  return [...by.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}

export interface NfFarmer {
  id: number; code: string; name: string; mobile: string | null;
  village: string | null; district: string | null; region: string | null; store: string | null; storeCode: string | null;
  origin: OriginKey; originLabel: string; via: string; addedBy: string; addedAt: string;
  status: string;   // Lead — no purchase yet | First purchase | Repeat buyer (2+ bills)
  tier: string;     // HNI | Potential HNI | Regular | No spend (live, from base spend)
  bills: number; value: number; firstPurchase: string | null; lastPurchase: string | null;
  boughtAt: string; topItems: string; crops: string; visits: number;
}
export interface NfBucket { label: string; n: number; value: number }
export interface NfDay {
  date: string; total: number; bought: number; leads: number; value: number; avgBill: number;
  byOrigin: (NfBucket & { key: OriginKey })[];
  byStatus: NfBucket[]; byTier: NfBucket[];
  byRegion: NfBucket[]; byDistrict: NfBucket[]; byStore: NfBucket[]; byVillage: NfBucket[];
  byCrop: NfBucket[]; byCategory: NfBucket[];
  runs: string[]; // ERP runs that created farmers that day
  farmers: NfFarmer[];
}

const TIER = (v: number) => (v >= VALUE_HNI_MIN ? "HNI" : v >= VALUE_POTENTIAL_MIN ? "Potential HNI" : v > 0 ? "Regular" : "No spend");

/** Full analysis of the farmers added on one IST day ("YYYY-MM-DD"). */
export async function getNewFarmerDay(date: string): Promise<NfDay | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const scope = await scopeSql();
  if (!scope) return null;
  const start = new Date(new Date(`${date}T00:00:00Z`).getTime() - IST_MS);
  const end = new Date(start.getTime() + 864e5);

  const ids = (await prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
    SELECT f.id FROM "Farmer" f WHERE f.source = 'REAL' AND f."createdAt" >= ${start} AND f."createdAt" < ${end} ${scope}`)).map((r) => r.id);
  const empty: NfDay = { date, total: 0, bought: 0, leads: 0, value: 0, avgBill: 0, byOrigin: [], byStatus: [], byTier: [], byRegion: [], byDistrict: [], byStore: [], byVillage: [], byCrop: [], byCategory: [], runs: [], farmers: [] };
  if (!ids.length) return empty;

  const [farmers, lines, visits, runs, imports] = await Promise.all([
    prisma.farmer.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true, name: true, mobile: true, village: true, district: true, createdAt: true, importId: true, store: { select: { code: true, name: true, zone: true } } },
    }),
    prisma.saleLine.findMany({
      where: { farmerId: { in: ids }, source: "REAL" },
      select: { farmerId: true, orderNo: true, soldAt: true, basic: true, itemRaw: true, cropTag: true, mainCategory: true, storeRef: { select: { name: true } } },
    }),
    prisma.visit.findMany({
      where: { farmerId: { in: ids } }, orderBy: { createdAt: "asc" },
      select: { farmerId: true, recordedBy: true, recordedByCode: true, officerName: true, store: { select: { name: true } } },
    }),
    prisma.erpSyncRun.findMany({
      where: { createdAt: { gte: new Date(start.getTime() - 2 * 864e5), lt: end } },
      select: { id: true, fromDate: true, toDate: true, triggeredBy: true, createdAt: true, durationMs: true },
    }),
    prisma.salesImport.findMany({ select: { id: true, filename: true, uploadedBy: true } }),
  ]);
  const importById = new Map(imports.map((i) => [i.id, i]));
  const firstVisit = new Map<number, (typeof visits)[number]>();
  const visitCount = new Map<number, number>();
  for (const v of visits) { if (v.farmerId == null) continue; if (!firstVisit.has(v.farmerId)) firstVisit.set(v.farmerId, v); visitCount.set(v.farmerId, (visitCount.get(v.farmerId) ?? 0) + 1); }

  type Agg = { bills: Set<string>; value: number; first: Date | null; last: Date | null; items: Map<string, number>; crops: Map<string, number>; cats: Map<string, number>; stores: Set<string> };
  const agg = new Map<number, Agg>();
  for (const l of lines) {
    if (l.farmerId == null) continue;
    const a = agg.get(l.farmerId) ?? agg.set(l.farmerId, { bills: new Set(), value: 0, first: null, last: null, items: new Map(), crops: new Map(), cats: new Map(), stores: new Set() }).get(l.farmerId)!;
    const v = l.basic ?? 0;
    a.bills.add(l.orderNo); a.value += v;
    if (l.soldAt && (!a.first || l.soldAt < a.first)) a.first = l.soldAt;
    if (l.soldAt && (!a.last || l.soldAt > a.last)) a.last = l.soldAt;
    a.items.set(l.itemRaw, (a.items.get(l.itemRaw) ?? 0) + v);
    if (l.cropTag) a.crops.set(l.cropTag, (a.crops.get(l.cropTag) ?? 0) + v);
    if (l.mainCategory) a.cats.set(l.mainCategory, (a.cats.get(l.mainCategory) ?? 0) + v);
    if (l.storeRef?.name) a.stores.add(shortStoreName(l.storeRef.name) || l.storeRef.name);
  }
  const topKeys = (m: Map<string, number>, k: number) => [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, k).map(([key]) => key);

  const runLabels = new Map<number, string>();
  const out: NfFarmer[] = farmers.map((f) => {
    const o = originOf(f, runs);
    const a = agg.get(f.id);
    const fv = firstVisit.get(f.id);
    let via = "", addedBy = "";
    if (o.key === "VISIT") { via = fv?.store?.name ? `Visit form · ${shortStoreName(fv.store.name) || fv.store.name}` : "Visit form"; const who = fv ? (fv.recordedBy ?? "").trim() || (fv.officerName ?? "").trim() : ""; addedBy = who ? `${who}${fv?.recordedByCode ? ` (${fv.recordedByCode})` : ""}` : ""; }
    else if (o.key === "IMPORT") { const im = f.importId != null ? importById.get(f.importId) : undefined; via = im?.filename ?? "Excel upload"; addedBy = im?.uploadedBy ?? ""; }
    else if (o.run) {
      const lbl = `Run #${o.run.id} · sales ${o.run.fromDate} → ${o.run.toDate}`;
      runLabels.set(o.run.id, lbl); via = lbl;
      addedBy = o.key === "ERP_MANUAL" ? (o.run.triggeredBy ?? "").split(":").slice(1).join(":") : "Automatic";
    }
    const bills = a?.bills.size ?? 0;
    const value = Math.round(a?.value ?? 0);
    return {
      id: f.id, code: f.code, name: f.name, mobile: f.mobile,
      village: locVal(f.village), district: locVal(f.district), region: locVal(f.store?.zone), store: f.store?.name ? shortStoreName(f.store.name) || f.store.name : null, storeCode: f.store?.code ?? null,
      origin: o.key, originLabel: ORIGIN_LABEL[o.key], via, addedBy, addedAt: f.createdAt.toISOString(),
      status: bills === 0 ? "Lead — no purchase yet" : bills === 1 ? "First purchase (1 bill)" : "Repeat buyer (2+ bills)",
      tier: TIER(value), bills, value,
      firstPurchase: a?.first ? a.first.toISOString().slice(0, 10) : null, lastPurchase: a?.last ? a.last.toISOString().slice(0, 10) : null,
      boughtAt: a ? [...a.stores].join(", ") : "", topItems: a ? topKeys(a.items, 3).join(", ") : "", crops: a ? topKeys(a.crops, 3).map(cropLabel).join(", ") : "",
      visits: visitCount.get(f.id) ?? 0,
    };
  }).sort((x, y) => y.value - x.value || x.name.localeCompare(y.name));

  const bucket = (key: (f: NfFarmer) => string | null, limit = 0): NfBucket[] => {
    const m = new Map<string, NfBucket>();
    for (const f of out) { const k = key(f) || "Not set"; const b = m.get(k) ?? m.set(k, { label: k, n: 0, value: 0 }).get(k)!; b.n++; b.value += f.value; }
    const rows = [...m.values()].sort((a, b) => (a.label === "Not set" ? 1 : b.label === "Not set" ? -1 : b.n - a.n || b.value - a.value));
    return limit ? rows.slice(0, limit) : rows;
  };
  const valueBucket = (src: (a: Agg) => Map<string, number>, fmt: (s: string) => string): NfBucket[] => {
    const m = new Map<string, NfBucket>();
    for (const a of agg.values()) for (const [k, v] of src(a)) { const b = m.get(k) ?? m.set(k, { label: fmt(k), n: 0, value: 0 }).get(k)!; b.n++; b.value += Math.round(v); }
    return [...m.values()].sort((a, b) => b.value - a.value).slice(0, 12);
  };
  const byOriginMap = new Map<OriginKey, NfBucket & { key: OriginKey }>();
  for (const f of out) { const b = byOriginMap.get(f.origin) ?? byOriginMap.set(f.origin, { key: f.origin, label: f.originLabel, n: 0, value: 0 }).get(f.origin)!; b.n++; b.value += f.value; }

  const bought = out.filter((f) => f.bills > 0);
  const totalBills = bought.reduce((s, f) => s + f.bills, 0);
  const value = bought.reduce((s, f) => s + f.value, 0);
  const TIER_ORDER = ["HNI", "Potential HNI", "Regular", "No spend"];
  return {
    date, total: out.length, bought: bought.length, leads: out.length - bought.length, value, avgBill: totalBills ? Math.round(value / totalBills) : 0,
    byOrigin: [...byOriginMap.values()].sort((a, b) => b.n - a.n),
    byStatus: bucket((f) => f.status),
    byTier: bucket((f) => f.tier).sort((a, b) => TIER_ORDER.indexOf(a.label) - TIER_ORDER.indexOf(b.label)),
    byRegion: bucket((f) => f.region), byDistrict: bucket((f) => f.district), byStore: bucket((f) => f.store, 40), byVillage: bucket((f) => f.village, 40),
    byCrop: valueBucket((a) => a.crops, cropLabel), byCategory: valueBucket((a) => a.cats, (s) => s),
    runs: [...runLabels.values()],
    farmers: out.slice(0, 3000),
  };
}

/** Excel of one day's new farmers (sysadmin only — matches the other sales/farmer exports). */
export async function exportNewFarmerDayXlsx(date: string): Promise<{ ok: boolean; filename?: string; b64?: string; error?: string }> {
  const { role } = await getScope();
  if (role !== "sysadmin") return { ok: false, error: "Only the System Admin can download this." };
  const d = await getNewFarmerDay(date);
  if (!d || !d.total) return { ok: false, error: "No farmers were added on this day." };
  const header = ["Farmer code", "Farmer name", "Mobile", "Village", "District", "Region (home store)", "Home store code", "Home store",
    "How the farmer was added", "Added via (run / file / form)", "Added by", "Added on (IST)",
    "Customer status", "Value tier (by base spend)", "Bills (all time)", "Base value, all time (₹, before GST)", "First purchase", "Last purchase",
    "Bought at (stores)", "Top items", "Crops", "Field visits recorded"];
  const ist = (iso: string) => new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(0, 16).replace("T", " ");
  const rows = d.farmers.map((f) => [f.code, f.name, f.mobile ?? "", f.village ?? "", f.district ?? "", f.region ?? "", f.storeCode ?? "", f.store ?? "",
    f.originLabel, f.via, f.addedBy, ist(f.addedAt), f.status, f.tier, f.bills, f.value, f.firstPurchase ?? "", f.lastPurchase ?? "", f.boughtAt, f.topItems, f.crops, f.visits]);
  const b64 = await buildStyledWorkbookB64([{ name: `New farmers ${date}`, rows: [header, ...rows], numFmt: { 14: "#,##0", 15: "#,##0", 21: "#,##0" }, wrapHeaders: true }]);
  return { ok: true, filename: `New_farmers_${date}.xlsx`, b64 };
}
