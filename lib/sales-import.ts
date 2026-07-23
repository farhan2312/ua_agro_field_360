/**
 * Shared monthly-sales importer (used by the admin Sales Import page and the CLI).
 *
 * Takes a parsed row matrix (from CSV or xlsx), aggregates line-items into bills,
 * creates Farmer records for new customer mobiles, and appends the sales —
 * idempotent by invoice (Order No), so re-uploading a file replaces exactly its
 * own bills and never touches unrelated history.
 */
import { prisma } from "@/lib/prisma";

export interface ImportSummary {
  lineItems: number;
  bills: number;
  newCustomers: number;
  salesInserted: number;
  skipped: number; // bills dropped for missing/invalid mobile
  rangeStart: string | null;
  rangeEnd: string | null;
  itemCodesSeen: number; // distinct item codes in the file
  itemCodesMatched: number; // of those, found in the inventory master
  farmersTagged: number; // farmers whose crop/pest tags were enriched from item codes
}

/** Minimal RFC-4180 CSV parser (handles quoted commas + escaped quotes + BOM). */
export function parseCsvMatrix(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQ = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQ) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\r") { /* skip */ }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function normMobile(v: string | null | undefined): string | null {
  if (!v) return null;
  let s = String(v).replace(/\D/g, "");
  if (s.length > 10) s = s.slice(-10);
  return s.length === 10 && "6789".includes(s[0]) ? s : null;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
/** Parse "01-Apr-2026" (primary) or any Date-parseable string → "YYYY-MM-DD". */
function toIso(billDate: string): string | null {
  const s = (billDate || "").trim();
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (m) {
    const mm = MONTHS[m[2].toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const normName = (s: string) => (s || "").toUpperCase().replace(/\s+/g, " ").trim();
const fyLabel = (fy: string) => (/^\d{4}$/.test(fy) ? `FY ${fy.slice(0, 2)}-${fy.slice(2)}` : fy || null);
function displayDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

interface Bill {
  order: string; total: number; itemNames: string[]; itemCodes: string[]; category: string | null;
  dateIso: string | null; dateStr: string; mobile: string | null;
  store: string; name: string; village: string; fy: string;
}

const q = (s: string) => `'${String(s).replace(/'/g, "''")}'`;
const pgArr = (a: string[]) => (a.length ? `ARRAY[${a.map(q).join(",")}]::text[]` : "ARRAY[]::text[]");

async function chunk<T>(items: T[], size: number, fn: (slice: T[]) => Promise<number>): Promise<number> {
  let n = 0;
  for (let i = 0; i < items.length; i += size) n += await fn(items.slice(i, i + size));
  return n;
}

/** Import a parsed sales matrix (header row + line-items). Throws on a bad file shape. */
export async function importSalesMatrix(rows: string[][], _uploadedBy: string): Promise<ImportSummary> {
  if (!rows.length) throw new Error("The file is empty.");
  const header = rows[0].map((h) => String(h ?? "").trim().replace(/^﻿/, ""));
  const col = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iOrder = col("Order No"), iItem = col("Item Name"), iCat = col("MainCategory"),
    iTotal = col("Total"), iDate = col("BillDate"), iMobile = col("Cus Mobile"),
    iStore = col("Retailer Name"), iName = col("Cus Name"), iVillage = col("Cus Village"),
    iFy = col("Financial Year"), iCode = col("Item Code"); // Item Code → crop/pest auto-mapping

  const missing = [
    ["Order No", iOrder], ["Total", iTotal], ["BillDate", iDate], ["Cus Mobile", iMobile],
  ].filter(([, idx]) => (idx as number) < 0).map(([n]) => n as string);
  if (missing.length) throw new Error(`Missing required column(s): ${missing.join(", ")}. Download the template for the expected format.`);

  // ── Aggregate line-items → bills ──
  const bills = new Map<string, Bill>();
  let lineItems = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const order = String(row[iOrder] ?? "").trim();
    if (!order) continue;
    lineItems++;
    let b = bills.get(order);
    if (!b) {
      b = {
        order, total: 0, itemNames: [], itemCodes: [], category: String(row[iCat] ?? "").trim() || null,
        dateIso: toIso(String(row[iDate] ?? "")), dateStr: String(row[iDate] ?? "").trim(),
        mobile: normMobile(String(row[iMobile] ?? "")), store: String(row[iStore] ?? "").trim(),
        name: String(row[iName] ?? "").trim(), village: String(row[iVillage] ?? "").trim(),
        fy: String(row[iFy] ?? "").trim(),
      };
      bills.set(order, b);
    }
    b.total += parseFloat(String(row[iTotal] ?? "0").replace(/[^0-9.\-]/g, "")) || 0;
    const item = String(row[iItem] ?? "").trim();
    if (item) b.itemNames.push(item);
    const code = iCode >= 0 ? String(row[iCode] ?? "").trim() : "";
    if (code) b.itemCodes.push(code);
  }
  const billArr = [...bills.values()];
  if (!billArr.length) throw new Error("No invoice rows found (is the 'Order No' column populated?).");

  // ── Store name → {id, code, zone} for linking new farmers ──
  const stores = await prisma.store.findMany({ select: { id: true, code: true, name: true, zone: true } });
  const storeByName = new Map(stores.map((s) => [normName(s.name), s]));

  const loadFarmers = async () => {
    const map = new Map<string, number>();
    const fs = await prisma.farmer.findMany({ select: { id: true, mobile: true } });
    for (const f of fs) { const m = normMobile(f.mobile); if (m && !map.has(m)) map.set(m, f.id); }
    return map;
  };
  let mobileToId = await loadFarmers();

  // ── Create farmers for new customer mobiles ──
  const newByMobile = new Map<string, Bill>();
  for (const b of billArr) {
    if (!b.mobile || mobileToId.has(b.mobile) || newByMobile.has(b.mobile)) continue;
    newByMobile.set(b.mobile, b);
  }
  const newFarmerData = [...newByMobile.values()].map((b) => {
    const st = storeByName.get(normName(b.store));
    return {
      code: `FARM-C-${b.mobile}`,
      name: b.name || "New Customer",
      mobile: b.mobile,
      village: b.village || null,
      district: st?.zone || null,
      zone: st?.zone || null,
      storeId: st?.id ?? null,
      storeCode: st?.code ?? null,
      source: "REAL" as const,
    };
  });
  if (newFarmerData.length) {
    await chunk(newFarmerData, 5000, (s) => prisma.farmer.createMany({ data: s as never, skipDuplicates: true }).then((r) => r.count));
    mobileToId = await loadFarmers();
  }

  // ── Idempotency: replace this file's own bills (delete by invoice), keep all else ──
  const orders = billArr.map((b) => b.order);
  await chunk(orders, 5000, (s) =>
    prisma.sale.deleteMany({ where: { source: "REAL", invoice: { in: s } } }).then((r) => r.count),
  );

  // ── Build + insert sales ──
  let matched = 0, skipped = 0;
  let minIso: string | null = null, maxIso: string | null = null;
  const saleData: Record<string, unknown>[] = [];
  const codesByFarmer = new Map<number, Set<string>>(); // farmerId → item codes purchased (this file)
  for (const b of billArr) {
    if (!b.mobile) { skipped++; continue; }
    const farmerId = mobileToId.get(b.mobile);
    if (!farmerId) { skipped++; continue; }
    matched++;
    if (b.itemCodes.length) {
      const set = codesByFarmer.get(farmerId) ?? codesByFarmer.set(farmerId, new Set()).get(farmerId)!;
      for (const c of b.itemCodes) set.add(c);
    }
    if (b.dateIso) {
      if (!minIso || b.dateIso < minIso) minIso = b.dateIso;
      if (!maxIso || b.dateIso > maxIso) maxIso = b.dateIso;
    }
    const first = b.itemNames[0] ?? "Item";
    saleData.push({
      farmerId,
      invoice: b.order,
      date: b.dateStr || null,
      soldAt: b.dateIso ? new Date(`${b.dateIso}T00:00:00Z`) : null,
      items: b.itemNames.length > 1 ? `${first} · +${b.itemNames.length - 1} more` : first,
      itemCount: b.itemNames.length || null,
      itemCodes: [...new Set(b.itemCodes)],
      category: b.category,
      amount: inr(b.total),
      amountNum: Math.round(b.total),
      store: b.store || null,
      financialYear: fyLabel(b.fy),
      source: "REAL" as const,
    });
  }
  const salesInserted = await chunk(saleData, 5000, (s) =>
    prisma.sale.createMany({ data: s as never, skipDuplicates: true }).then((r) => r.count),
  );

  // ── Auto-map purchased Item Codes → Target Crops + Target Pests, enrich the farmer ──
  // Every code in the file is looked up in the inventory master (Product.itemCode); each
  // farmer's crop/pest tags are UNION-ed with the crops/pests of what they bought. Additive:
  // a correction re-upload adds new tags but never retracts old ones (matches the "has ever
  // bought" semantics of the existing crop base).
  const allCodes = [...new Set([...codesByFarmer.values()].flatMap((s) => [...s]))];
  let itemCodesMatched = 0, farmersTagged = 0;
  if (allCodes.length) {
    const codeMap = new Map<string, { crops: string[]; pests: string[] }>();
    await chunk(allCodes, 5000, async (s) => {
      const prods = await prisma.product.findMany({
        where: { itemCode: { in: s } },
        select: { itemCode: true, targetCrops: true, targetPests: true },
      });
      for (const p of prods) if (p.itemCode) codeMap.set(p.itemCode, { crops: p.targetCrops, pests: p.targetPests });
      return prods.length;
    });
    itemCodesMatched = codeMap.size;

    // Union crops+pests per affected farmer.
    const valueRows: string[] = [];
    for (const [farmerId, codes] of codesByFarmer) {
      const crops = new Set<string>(), pests = new Set<string>();
      for (const c of codes) { const m = codeMap.get(c); if (!m) continue; m.crops.forEach((x) => crops.add(x)); m.pests.forEach((x) => pests.add(x)); }
      if (!crops.size && !pests.size) continue;
      valueRows.push(`(${farmerId}::int, ${pgArr([...crops].sort())}, ${pgArr([...pests].sort())})`);
    }
    farmersTagged = valueRows.length;
    // Bulk in-place union (existing || new, distinct) so we never read-then-write per farmer.
    for (let i = 0; i < valueRows.length; i += 1000) {
      const slice = valueRows.slice(i, i + 1000);
      await prisma.$executeRawUnsafe(
        `UPDATE "Farmer" f SET
           "cropTags"      = ARRAY(SELECT DISTINCT e FROM unnest(f."cropTags"      || v.crops) e ORDER BY e),
           "salesCropTags" = ARRAY(SELECT DISTINCT e FROM unnest(f."salesCropTags" || v.crops) e ORDER BY e),
           "pestTags"      = ARRAY(SELECT DISTINCT e FROM unnest(f."pestTags"      || v.pests) e ORDER BY e)
         FROM (VALUES ${slice.join(",")}) AS v(id, crops, pests) WHERE f.id = v.id`);
    }
  }

  return {
    lineItems,
    bills: billArr.length,
    newCustomers: newFarmerData.length,
    salesInserted,
    skipped,
    rangeStart: minIso ? displayDate(minIso) : null,
    rangeEnd: maxIso ? displayDate(maxIso) : null,
    itemCodesSeen: allCodes.length,
    itemCodesMatched,
    farmersTagged,
  };
}
