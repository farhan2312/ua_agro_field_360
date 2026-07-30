import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getScope } from "@/lib/scope";
import { SPEND_TIERS } from "@/lib/spend-tiers";
import { cropLabel } from "@/lib/crops";
import { segMeta } from "@/lib/campaign-segments";

export const dynamic = "force-dynamic";

/**
 * Streaming CSV export of ALL matching sale lines — the whole line-level dataset, uncapped.
 * A route handler (not a server action) so it is NOT bound by the 12 MB server-action response
 * limit; it streams the file in keyset-paged batches, so memory stays bounded at any size.
 *
 * Value/lifecycle come from the farmer's STORED tier (Farmer.valueSegment/lifecycleSegment) — which,
 * for the whole-data (no-FY) view, is exactly what the analytics page shows. RBAC is enforced from the
 * session (officer → own store, RM → own district). Filters arrive base64-encoded in `?f=`.
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

export async function GET(req: NextRequest) {
  const scope = await getScope();

  let f: ExportFilters = {};
  const raw = req.nextUrl.searchParams.get("f");
  if (raw) { try { f = JSON.parse(Buffer.from(decodeURIComponent(raw), "base64").toString("utf8")); } catch { f = {}; } }

  // RBAC: pin scoped users to their own store / district (never widen past scope).
  let storeIds = f.storeIds, zones = f.zones;
  if (scope.role === "officer") {
    if (scope.storeId == null) return new Response("No store assigned to your account.", { status: 403 });
    storeIds = [scope.storeId]; zones = undefined;
  } else if (scope.role === "regional") {
    if (!scope.zone) return new Response("No district assigned to your account.", { status: 403 });
    zones = [scope.zone];
  }

  const conds: Prisma.Sql[] = [Prisma.sql`sl.source = 'REAL'`, Prisma.sql`sl."farmerId" IS NOT NULL`, Prisma.sql`f.source = 'REAL'`];
  if (storeIds?.length) conds.push(Prisma.sql`f."storeId" = ANY(${storeIds})`);
  if (zones?.length) conds.push(Prisma.sql`st."zone" = ANY(${zones})`);
  if (f.pests?.length) conds.push(Prisma.sql`f."pestTags" && ${f.pests}::text[]`);
  if (f.valueSegments?.length) conds.push(Prisma.sql`f."valueSegment" = ANY(${f.valueSegments})`);
  if (f.lifecycleSegments?.length) conds.push(Prisma.sql`f."lifecycleSegment" = ANY(${f.lifecycleSegments})`);
  if (f.crops?.length) conds.push(Prisma.sql`sl."cropTag" = ANY(${f.crops}::text[])`);
  const fyw = fyWindow(f.fyStarts); if (fyw) conds.push(fyw);
  if (f.spendTiers?.length) {
    const ors = f.spendTiers.map((i) => SPEND_TIERS[i]).filter(Boolean).map((t) => {
      if (t.max === 0 && t.min == null) return Prisma.sql`(f."lifetimeSpend" IS NULL OR f."lifetimeSpend" <= 0)`;
      const p: Prisma.Sql[] = [];
      if (t.min != null) p.push(Prisma.sql`f."lifetimeSpend" >= ${t.min}`);
      if (t.max != null) p.push(Prisma.sql`f."lifetimeSpend" < ${t.max}`);
      return p.length ? Prisma.sql`(${Prisma.join(p, " AND ")})` : Prisma.sql`TRUE`;
    });
    if (ors.length) conds.push(Prisma.sql`(${Prisma.join(ors, " OR ")})`);
  }
  const where = Prisma.join(conds, " AND ");

  const stores = await prisma.store.findMany({ select: { id: true, name: true } });
  const nameById = new Map(stores.map((s) => [s.id, s.name.replace(/\s*\(.*?\)\s*/g, "").trim() || s.name]));

  const cell = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const header = ["Order No", "Date", "Financial year", "Farmer", "Mobile", "Store", "District", "Item", "Crop", "Category", "Qty", "UOM", "Base value (Rs)", "Value segment", "Lifecycle"];

  const BATCH = 10000;
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(enc.encode("﻿" + header.join(",") + "\n")); // BOM so Excel reads UTF-8
        let cursor = 0;
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
            WHERE ${where} AND sl.id > ${cursor}
            ORDER BY sl.id LIMIT ${BATCH}`);
          if (!rows.length) break;
          let chunk = "";
          for (const r of rows) {
            cursor = r.id;
            chunk += [
              cell(r.ordno), r.soldat ? new Date(r.soldat).toISOString().slice(0, 10) : "", cell(r.fy),
              cell(r.name), cell(r.mobile), cell(r.sid != null ? nameById.get(r.sid) ?? "" : ""), cell(r.zone),
              cell(r.item), cell(r.crop ? cropLabel(r.crop) : ""), cell(r.cat), r.qty ?? 0, cell(r.uom),
              Math.round(r.basic ?? 0), cell(r.vseg ? segMeta(r.vseg).label : ""), cell(r.lseg ? segMeta(r.lseg).label : ""),
            ].join(",") + "\n";
          }
          controller.enqueue(enc.encode(chunk));
          if (rows.length < BATCH) break;
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });

  const ts = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="analytics-sales-lines-${ts}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
