import { prisma } from "@/lib/prisma";
import { cropFromItem } from "@/lib/crop-clean";
import { recomputeSegments } from "@/lib/segment-engine";

/**
 * ERP sales feed (uaagrostore.com) → Sale bills + SaleLine rows, the future authoritative source of
 * sales data. Richer than the Excel upload: real per-line TaxableValue (base), qty, tax, discount.
 *
 *   fetchErpSales(from,to,storeId?)  — pull line rows (omit storeId = all stores)
 *   importErpRows(rows,from,to)      — normalise → bills + lines + farmers, idempotent by date window
 *   syncErpSales({from,to,by})       — fetch + import + scoped segment recompute + ErpSyncRun log
 *
 * Notes: no Crops column yet (crop tags = seed-name via cropFromItem until the ERP adds one); no master
 * Item Code (products resolved by name); ReturnQty is stored but NOT netted (gross counted, per spec).
 */

const API_URL = process.env.ERP_API_URL || "http://uaagrostore.com/APPs/api.php";
const COMPANY_ID = process.env.ERP_COMPANY_ID || "3";

export interface ErpRow {
  RetailerName?: string; OrderNo?: string; ItemName?: string; MainCategory?: string; SubCategory?: string;
  Qty?: string | number; Rate?: string | number; CGSTRate?: number; SGSTRate?: number;
  CGSTValue?: number; SGSTValue?: number; IGSTValue?: number; Total?: string | number; TaxableValue?: string | number;
  ItemDiscountAmount?: number; InvoiceDiscountAmount?: number; BatchNo?: string; ExpiryDate?: string;
  HSNCODE?: string; UOM?: string; FinancialYear?: string; BillDate?: string; PaymentType?: string;
  CusName?: string; CusAddress?: string; CusMobile?: string; CusVillage?: string; ReturnQty?: string | number;
}

const num = (v: unknown) => { const n = parseFloat(String(v ?? "0").replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : 0; };
const normMobile = (v: unknown): string | null => { let s = String(v ?? "").replace(/\D/g, ""); if (s.length > 10) s = s.slice(-10); return s.length === 10 && "6789".includes(s[0]) ? s : null; };
const normName = (s: string) => (s || "").toUpperCase().replace(/\s+/g, " ").trim();
const fyLabel = (fy: string) => (/^\d{4}$/.test(fy) ? `FY ${fy.slice(0, 2)}-${fy.slice(2)}` : fy || null);
const parseDate = (s?: string): Date | null => { if (!s) return null; const d = new Date(`${s.trim()}T00:00:00Z`); return Number.isNaN(d.getTime()) ? null : d; };
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

/** Pull sales line rows from the ERP for a date range (YYYY-MM-DD). Omit storeId for all stores. */
export async function fetchErpSales(from: string, to: string, storeId?: string): Promise<ErpRow[]> {
  const token = process.env.SALES_API_TOKEN;
  if (!token) throw new Error("SALES_API_TOKEN is not configured.");
  const body: Record<string, string> = { type: "sales", company_id: COMPANY_ID, from_order_date: from, to_order_date: to };
  if (storeId) body.store_id = storeId;
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new Error(`ERP returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`); }
  const j = json as { status?: string; response?: unknown };
  if (String(j.status) !== "200") throw new Error(`ERP error (status ${j.status}): ${typeof j.response === "string" ? j.response : "unexpected response"}`);
  return Array.isArray(j.response) ? (j.response as ErpRow[]) : [];
}

export interface ErpImportResult { rows: number; bills: number; newCustomers: number; linesInserted: number; stores: number; affectedFarmerIds: number[] }

/**
 * Normalise ERP rows into Sale bills + SaleLine rows. Idempotent: replaces all REAL sales in the
 * [from,to] date window (delete-by-window avoids invoice-collision damage), then inserts fresh.
 * Fetch first, delete second — a failed fetch never deletes anything (the caller guards that).
 */
export async function importErpRows(rows: ErpRow[], from: string, to: string): Promise<ErpImportResult> {
  const fromDt = new Date(`${from}T00:00:00Z`);
  const toDt = new Date(`${to}T23:59:59.999Z`);

  // ── Resolve stores (small), farmers (by batch mobile), products (by name) ──
  const stores = await prisma.store.findMany({ select: { id: true, code: true, name: true, zone: true } });
  const storeByName = new Map(stores.map((s) => [normName(s.name), s]));

  const mobiles = [...new Set(rows.map((r) => normMobile(r.CusMobile)).filter((m): m is string => !!m))];
  const mobileToId = new Map<string, number>();
  for (let i = 0; i < mobiles.length; i += 5000) {
    const fs = await prisma.farmer.findMany({ where: { mobile: { in: mobiles.slice(i, i + 5000) } }, select: { id: true, mobile: true } });
    for (const f of fs) { const m = normMobile(f.mobile); if (m && !mobileToId.has(m)) mobileToId.set(m, f.id); }
  }
  // Create farmers for new customer mobiles (village name from CusAddress; store from RetailerName).
  const newByMobile = new Map<string, ErpRow>();
  for (const r of rows) { const m = normMobile(r.CusMobile); if (m && !mobileToId.has(m) && !newByMobile.has(m)) newByMobile.set(m, r); }
  let newCustomers = 0;
  if (newByMobile.size) {
    const data = [...newByMobile.entries()].map(([mobile, r]) => {
      const st = storeByName.get(normName(r.RetailerName ?? ""));
      return { code: `FARM-C-${mobile}`, name: (r.CusName || "New Customer").toString(), mobile, village: r.CusAddress || null, district: st?.zone || null, zone: st?.zone || null, storeId: st?.id ?? null, storeCode: st?.code ?? null, source: "REAL" as const };
    });
    for (let i = 0; i < data.length; i += 5000) newCustomers += (await prisma.farmer.createMany({ data: data as never, skipDuplicates: true })).count;
    for (let i = 0; i < mobiles.length; i += 5000) {
      const fs = await prisma.farmer.findMany({ where: { mobile: { in: mobiles.slice(i, i + 5000) } }, select: { id: true, mobile: true } });
      for (const f of fs) { const m = normMobile(f.mobile); if (m && !mobileToId.has(m)) mobileToId.set(m, f.id); }
    }
  }

  const itemNames = [...new Set(rows.map((r) => (r.ItemName ?? "").trim()).filter(Boolean))];
  const prodByName = new Map<string, number>();
  for (let i = 0; i < itemNames.length; i += 5000) {
    const ps = await prisma.product.findMany({ where: { rawName: { in: itemNames.slice(i, i + 5000) } }, select: { id: true, rawName: true } });
    for (const p of ps) prodByName.set(p.rawName, p.id);
  }
  const missingItems = itemNames.filter((n) => !prodByName.has(n));
  if (missingItems.length) {
    const byName = new Map(rows.map((r) => [(r.ItemName ?? "").trim(), r]));
    const data = missingItems.map((n) => { const r = byName.get(n); const seed = cropFromItem(n); return { rawName: n, name: n, mainCategory: r?.MainCategory || null, subCategory: r?.SubCategory || null, uom: r?.UOM || null, hsnCode: r?.HSNCODE || null, isSeed: seed != null, cropTag: seed }; });
    for (let i = 0; i < data.length; i += 1000) await prisma.product.createMany({ data: data as never, skipDuplicates: true });
    for (let i = 0; i < missingItems.length; i += 5000) {
      const ps = await prisma.product.findMany({ where: { rawName: { in: missingItems.slice(i, i + 5000) } }, select: { id: true, rawName: true } });
      for (const p of ps) prodByName.set(p.rawName, p.id);
    }
  }

  // ── Aggregate lines → bills ──
  interface Bill { order: string; total: number; items: string[]; category: string | null; date: Date | null; mobile: string | null; store: string; name: string; fy: string | null }
  const bills = new Map<string, Bill>();
  for (const r of rows) {
    const order = (r.OrderNo ?? "").trim(); if (!order) continue;
    let b = bills.get(order);
    if (!b) { b = { order, total: 0, items: [], category: r.MainCategory || null, date: parseDate(r.BillDate), mobile: normMobile(r.CusMobile), store: r.RetailerName || "", name: r.CusName || "", fy: r.FinancialYear || null }; bills.set(order, b); }
    b.total += num(r.Total);
    if (r.ItemName) b.items.push(r.ItemName.trim());
  }

  // ── Idempotent replace: clear the window's REAL sales + lines, then insert ──
  const winLines = await prisma.saleLine.deleteMany({ where: { source: "REAL", soldAt: { gte: fromDt, lte: toDt } } });
  const winBills = await prisma.sale.deleteMany({ where: { source: "REAL", soldAt: { gte: fromDt, lte: toDt } } });
  void winLines; void winBills;

  // Insert Sale bills.
  const saleData = [...bills.values()].filter((b) => b.mobile && mobileToId.get(b.mobile)).map((b) => {
    const first = b.items[0] ?? "Item";
    return {
      farmerId: mobileToId.get(b.mobile!)!, invoice: b.order,
      date: b.date ? b.date.toISOString().slice(0, 10) : null, soldAt: b.date,
      items: b.items.length > 1 ? `${first} · +${b.items.length - 1} more` : first, itemCount: b.items.length || null,
      category: b.category, amount: inr(b.total), amountNum: Math.round(b.total),
      store: b.store || null, financialYear: fyLabel(b.fy ?? ""), source: "REAL" as const,
    };
  });
  for (let i = 0; i < saleData.length; i += 5000) await prisma.sale.createMany({ data: saleData.slice(i, i + 5000) as never, skipDuplicates: true });

  // Map invoice → saleId for the window (just inserted).
  const inserted = await prisma.sale.findMany({ where: { source: "REAL", soldAt: { gte: fromDt, lte: toDt } }, select: { id: true, invoice: true } });
  const saleIdByInvoice = new Map(inserted.map((s) => [s.invoice ?? "", s.id]));

  // Insert SaleLines (base = TaxableValue; ReturnQty stored, not netted).
  const affected = new Set<number>();
  const lineData: Record<string, unknown>[] = [];
  for (const r of rows) {
    const order = (r.OrderNo ?? "").trim(); const item = (r.ItemName ?? "").trim();
    const productId = item ? prodByName.get(item) : undefined;
    if (!order || !productId) continue;
    const mobile = normMobile(r.CusMobile); const farmerId = mobile ? mobileToId.get(mobile) ?? null : null;
    if (farmerId) affected.add(farmerId);
    const st = storeByName.get(normName(r.RetailerName ?? ""));
    const qty = num(r.Qty);
    lineData.push({
      orderNo: order, productId, itemRaw: item, saleId: saleIdByInvoice.get(order) ?? null,
      store: r.RetailerName || null, storeId: st?.id ?? null, farmerId,
      qty, returnQty: num(r.ReturnQty), uom: r.UOM || null,
      unitPrice: r.Rate != null ? num(r.Rate) : (qty > 0 ? num(r.Total) / qty : null),
      totalPrice: num(r.Total), basic: num(r.TaxableValue),
      cgstRate: r.CGSTRate ?? null, sgstRate: r.SGSTRate ?? null, cgst: r.CGSTValue ?? null, sgst: r.SGSTValue ?? null,
      discount: num(r.ItemDiscountAmount) + num(r.InvoiceDiscountAmount), batchNo: r.BatchNo || null,
      soldAt: parseDate(r.BillDate), financialYear: fyLabel(r.FinancialYear ?? ""),
      mainCategory: r.MainCategory || null, subCategory: r.SubCategory || null,
      custName: r.CusName || null, custPhone: mobile, cropTag: cropFromItem(item), source: "REAL" as const,
    });
  }
  let linesInserted = 0;
  for (let i = 0; i < lineData.length; i += 5000) linesInserted += (await prisma.saleLine.createMany({ data: lineData.slice(i, i + 5000) as never })).count;

  return { rows: rows.length, bills: bills.size, newCustomers, linesInserted, stores: new Set(rows.map((r) => r.RetailerName)).size, affectedFarmerIds: [...affected] };
}

export interface ErpSyncResult extends ErpImportResult { ok: boolean; runId: number; error?: string; durationMs: number }

/** Full sync: log run → fetch → import → scoped segment recompute → finalise. Never throws. */
export async function syncErpSales(opts: { from: string; to: string; triggeredBy: string }): Promise<ErpSyncResult> {
  const t0 = Date.now();
  const run = await prisma.erpSyncRun.create({ data: { fromDate: opts.from, toDate: opts.to, status: "RUNNING", triggeredBy: opts.triggeredBy } });
  try {
    const rows = await fetchErpSales(opts.from, opts.to); // fetch first — a failure never deletes data
    const r = await importErpRows(rows, opts.from, opts.to);
    if (r.affectedFarmerIds.length) { try { await recomputeSegments({ farmerIds: r.affectedFarmerIds }); } catch { /* best-effort */ } }
    const durationMs = Date.now() - t0;
    await prisma.erpSyncRun.update({ where: { id: run.id }, data: { status: "SUCCESS", rows: r.rows, bills: r.bills, newCustomers: r.newCustomers, linesInserted: r.linesInserted, stores: r.stores, durationMs } });
    return { ok: true, runId: run.id, durationMs, ...r };
  } catch (e) {
    const durationMs = Date.now() - t0;
    const error = e instanceof Error ? e.message : "Sync failed.";
    await prisma.erpSyncRun.update({ where: { id: run.id }, data: { status: "FAILED", error: error.slice(0, 500), durationMs } }).catch(() => {});
    return { ok: false, runId: run.id, durationMs, error, rows: 0, bills: 0, newCustomers: 0, linesInserted: 0, stores: 0, affectedFarmerIds: [] };
  }
}
