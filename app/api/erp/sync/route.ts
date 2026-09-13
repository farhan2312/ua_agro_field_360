import { NextResponse } from "next/server";
import { syncErpSales } from "@/lib/erp-sales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY = 86_400_000, IST = 330 * 60_000;
/** Yesterday's date in IST as YYYY-MM-DD (the ERP day the cron pulls). */
function yesterdayIST(): string {
  return new Date(Date.now() + IST - DAY).toISOString().slice(0, 10);
}

/**
 * Daily ERP sales sync — called by Vercel Cron (see vercel.json). Vercel attaches
 * `Authorization: Bearer $CRON_SECRET` to cron requests, which we require here. Defaults to yesterday
 * (all stores); ?from=&to= override for a manual catch-up (keep ranges small — big pulls use the script).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const url = new URL(req.url);
  const to = url.searchParams.get("to") || yesterdayIST();
  const from = url.searchParams.get("from") || to;
  const res = await syncErpSales({ from, to, triggeredBy: "schedule" });
  return NextResponse.json({ ok: res.ok, runId: res.runId, from, to, rows: res.rows, bills: res.bills, newCustomers: res.newCustomers, lines: res.linesInserted, stores: res.stores, error: res.error });
}
