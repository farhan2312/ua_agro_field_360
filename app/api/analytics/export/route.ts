import type { NextRequest } from "next/server";
import { PassThrough, Readable } from "node:stream";
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getScope } from "@/lib/scope";
import { SPEND_TIERS } from "@/lib/spend-tiers";
import { cropLabel } from "@/lib/crops";
import { tagLabel } from "@/lib/crop-pest";
import { segMeta, VALUE_SEGMENTS, LIFECYCLE_SEGMENTS } from "@/lib/campaign-segments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ONE streaming Excel export of the whole analytics dataset — matrix + every sale line + filters,
 * as a multi-sheet .xlsx. Uses exceljs' streaming WorkbookWriter piped through a Node PassThrough so
 * rows are flushed to the HTTP response as they're written: bounded memory, no size cap (verified on
 * ~481k lines). NOT a server action, so the 12 MB action-response limit does not apply. Value/lifecycle
 * come from the stored farmer tier; RBAC enforced from the session. Filters arrive base64 in `?f=`.
 */
interface ExportFilters {
  storeIds?: number[]; zones?: string[]; crops?: string[]; pests?: string[];
  valueSegments?: string[]; lifecycleSegments?: string[]; spendTiers?: number[]; fyStarts?: number[];
}

function fyWindow(fyStarts?: number[]): Prisma.Sql | null {
  if (!fyStarts?.length) return null;
  const ors = fyStarts.map((y) => Prisma.sql`(sl."soldAt" >= ${new Date(Date.UTC(y, 3, 1))} AND sl."soldAt" < ${new Date(Date.UTC(y + 1, 3, 1))})`);
  return Prisma.sql`(${Prisma.join(ors, " OR ")})`;
}

/** Farmer-level conditions shared by the matrix and the sale-lines query (alias f, store alias st). */
function farmerConds(f: ExportFilters, storeIds?: number[], zones?: string[]): Prisma.Sql[] {
  const c: Prisma.Sql[] = [Prisma.sql`f.source = 'REAL'`];
  if (storeIds?.length) c.push(Prisma.sql`f."storeId" = ANY(${storeIds})`);
  if (zones?.length) c.push(Prisma.sql`st."zone" = ANY(${zones})`);
  if (f.pests?.length) c.push(Prisma.sql`f."pestTags" && ${f.pests}::text[]`);
  if (f.valueSegments?.length) c.push(Prisma.sql`f."valueSegment" = ANY(${f.valueSegments})`);
  if (f.lifecycleSegments?.length) c.push(Prisma.sql`f."lifecycleSegment" = ANY(${f.lifecycleSegments})`);
  if (f.crops?.length) c.push(Prisma.sql`f."salesCropTags" && ${f.crops}::text[]`);
  if (f.spendTiers?.length) {
    const ors = f.spendTiers.map((i) => SPEND_TIERS[i]).filter(Boolean).map((t) => {
      if (t.max === 0 && t.min == null) return Prisma.sql`(f."lifetimeSpend" IS NULL OR f."lifetimeSpend" <= 0)`;
      const p: Prisma.Sql[] = [];
      if (t.min != null) p.push(Prisma.sql`f."lifetimeSpend" >= ${t.min}`);
      if (t.max != null) p.push(Prisma.sql`f."lifetimeSpend" < ${t.max}`);
      return p.length ? Prisma.sql`(${Prisma.join(p, " AND ")})` : Prisma.sql`TRUE`;
    });
    if (ors.length) c.push(Prisma.sql`(${Prisma.join(ors, " OR ")})`);
  }
  return c;
}

export async function GET(req: NextRequest) {
  const scope = await getScope();
  let f: ExportFilters = {};
  const raw = req.nextUrl.searchParams.get("f");
  if (raw) { try { f = JSON.parse(Buffer.from(decodeURIComponent(raw), "base64").toString("utf8")); } catch { f = {}; } }

  let storeIds = f.storeIds, zones = f.zones;
  if (scope.role === "officer") {
    if (scope.storeId == null) return new Response("No store assigned to your account.", { status: 403 });
    storeIds = [scope.storeId]; zones = undefined;
  } else if (scope.role === "regional") {
    if (!scope.zone) return new Response("No district assigned to your account.", { status: 403 });
    zones = [scope.zone];
  }

  const fConds = farmerConds(f, storeIds, zones);
  const fWhere = Prisma.join(fConds, " AND ");
  const cropLine = f.crops?.length ? Prisma.sql`AND sl."cropTag" = ANY(${f.crops}::text[])` : Prisma.empty;
  const fyw = fyWindow(f.fyStarts);
  const fyLine = fyw ? Prisma.sql`AND ${fyw}` : Prisma.empty;

  const stores = await prisma.store.findMany({ select: { id: true, name: true } });
  const nameById = new Map(stores.map((s) => [s.id, s.name.replace(/\s*\(.*?\)\s*/g, "").trim() || s.name]));
  const V = [...VALUE_SEGMENTS], L = [...LIFECYCLE_SEGMENTS];
  const combos = V.flatMap((v) => L.map((l) => [v, l] as const));

  const pass = new PassThrough();
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: pass, useStyles: false, useSharedStrings: false });

  // Write the workbook in the background; the Response streams `pass` as rows are flushed.
  (async () => {
    try {
      // ── Sheet 1: Value × Lifecycle × Store (farmer counts, stored tiers) ──
      const matrixRows = await prisma.$queryRaw<Array<{ sid: number | null; vseg: string | null; lseg: string | null; n: number }>>(Prisma.sql`
        SELECT f."storeId" sid, f."valueSegment" vseg, f."lifecycleSegment" lseg, COUNT(*)::int n
        FROM "Farmer" f LEFT JOIN "Store" st ON st.id = f."storeId"
        WHERE ${fWhere} GROUP BY 1, 2, 3`);
      const byStore = new Map<number | null, { cell: Record<string, number>; total: number }>();
      const grand: Record<string, number> = {}; let grandTotal = 0;
      for (const r of matrixRows) {
        const key = `${r.vseg ?? "REGULAR"}|${r.lseg ?? "LAPSED"}`;
        const st = byStore.get(r.sid) ?? { cell: {}, total: 0 };
        st.cell[key] = (st.cell[key] ?? 0) + r.n; st.total += r.n; byStore.set(r.sid, st);
        grand[key] = (grand[key] ?? 0) + r.n; grandTotal += r.n;
      }
      const matrixSorted = [...byStore.entries()].map(([sid, s]) => ({
        name: sid == null ? "Unassigned" : nameById.get(sid) ?? `Store #${sid}`, ...s,
      })).sort((a, b) => b.total - a.total).slice(0, 200);
      const ws1 = wb.addWorksheet("Value x Lifecycle x Store");
      ws1.addRow(["Store", ...combos.map(([v, l]) => `${segMeta(v).label} · ${segMeta(l).label}`), "Total"]).commit();
      ws1.addRow(["All stores", ...combos.map(([v, l]) => grand[`${v}|${l}`] ?? 0), grandTotal]).commit();
      for (const s of matrixSorted) ws1.addRow([s.name, ...combos.map(([v, l]) => s.cell[`${v}|${l}`] ?? 0), s.total]).commit();
      await ws1.commit();

      // ── Sheet 2: every matching sale line (keyset-paged) ──
      const ws2 = wb.addWorksheet("Sales lines");
      ws2.addRow(["Order No", "Date", "Financial year", "Farmer", "Mobile", "Store", "District", "Item", "Crop", "Category", "Qty", "UOM", "Base value (Rs)", "Value segment", "Lifecycle"]).commit();
      let cursor = 0, lineCount = 0;
      const BATCH = 10000;
      for (;;) {
        const rows = await prisma.$queryRaw<Array<{
          id: number; ordno: string | null; soldat: Date | null; fy: string | null; name: string; mobile: string | null;
          sid: number | null; zone: string | null; item: string; crop: string | null; cat: string | null;
          qty: number | null; uom: string | null; basic: number | null; vseg: string | null; lseg: string | null;
        }>>(Prisma.sql`
          SELECT sl.id, sl."orderNo" ordno, sl."soldAt" soldat, sl."financialYear" fy, f.name, f.mobile,
            f."storeId" sid, st."zone" zone, sl."itemRaw" item, sl."cropTag" crop, sl."mainCategory" cat,
            sl.qty, sl.uom, sl."basic" basic, f."valueSegment" vseg, f."lifecycleSegment" lseg
          FROM "SaleLine" sl JOIN "Farmer" f ON f.id = sl."farmerId" LEFT JOIN "Store" st ON st.id = f."storeId"
          WHERE sl.source = 'REAL' AND sl."farmerId" IS NOT NULL AND ${fWhere} ${cropLine} ${fyLine} AND sl.id > ${cursor}
          ORDER BY sl.id LIMIT ${BATCH}`);
        if (!rows.length) break;
        for (const r of rows) {
          cursor = r.id; lineCount++;
          ws2.addRow([
            r.ordno ?? "", r.soldat ? new Date(r.soldat).toISOString().slice(0, 10) : "", r.fy ?? "",
            r.name, r.mobile ?? "", r.sid != null ? nameById.get(r.sid) ?? "" : "", r.zone ?? "",
            r.item, r.crop ? cropLabel(r.crop) : "", r.cat ?? "", r.qty ?? 0, r.uom ?? "",
            Math.round(r.basic ?? 0), r.vseg ? segMeta(r.vseg).label : "", r.lseg ? segMeta(r.lseg).label : "",
          ]).commit();
        }
        if (rows.length < BATCH) break;
      }
      await ws2.commit();

      // ── Sheet 3: filters applied ──
      const list = <T,>(arr: T[] | undefined, fn: (x: T) => string, none: string) => (arr?.length ? arr.map(fn).join(", ") : none);
      const fyLbl = (y: number) => `FY ${y}-${String((y + 1) % 100).padStart(2, "0")}`;
      const ws3 = wb.addWorksheet("Filters applied");
      const fRows: (string | number)[][] = [
        ["Filter", "Applied"],
        ["Financial year(s)", list(f.fyStarts, fyLbl, "All FYs")],
        ["Stores", list(storeIds, (id) => nameById.get(id) ?? `#${id}`, "All stores")],
        ["Districts", list(zones, (z) => String(z), "All districts")],
        ["Crops", list(f.crops, cropLabel, "All crops")],
        ["Pests / diseases", list(f.pests, tagLabel, "All")],
        ["Value segment", list(f.valueSegments, (s) => segMeta(s).label, "All")],
        ["Lifecycle", list(f.lifecycleSegments, (s) => segMeta(s).label, "All")],
        ["Spend tier", list(f.spendTiers, (i) => SPEND_TIERS[i]?.label ?? String(i), "Any")],
        ["", ""],
        ["Farmers in matrix", grandTotal],
        ["Sale lines in file", lineCount],
        ["Money basis", "Base / pre-tax price (SaleLine.basic)"],
        ["Exported (UTC)", new Date().toISOString().slice(0, 19).replace("T", " ")],
      ];
      for (const r of fRows) ws3.addRow(r).commit();
      await ws3.commit();

      await wb.commit();
    } catch (e) {
      pass.destroy(e as Error);
    }
  })();

  const ts = new Date().toISOString().slice(0, 10);
  const filename = `analytics-export-${ts}.xlsx`;
  return new Response(Readable.toWeb(pass) as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Export-Filename": filename,
      "Cache-Control": "no-store",
    },
  });
}
