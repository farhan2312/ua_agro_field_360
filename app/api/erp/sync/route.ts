import { NextResponse } from "next/server";
import { syncErpSales } from "@/lib/erp-sales";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY = 86_400_000, IST = 330 * 60_000;
/** A date N days before today, in IST, as YYYY-MM-DD. daysAgo=1 → yesterday. */
function dateIST(daysAgo: number): string {
  return new Date(Date.now() + IST - daysAgo * DAY).toISOString().slice(0, 10);
}

/**
 * Daily ERP sales sync — called by Vercel Cron (see vercel.json). Vercel attaches
 * `Authorization: Bearer $CRON_SECRET` to cron requests, which we require here. Pulls the last
 * `lookbackDays` days up to yesterday (all stores); re-fetching is idempotent so overlap is safe.
 * The schedule can be paused and the lookback tuned from the Sales Sync page (Setting keys).
 * ?from=&to= override for a manual catch-up (keep ranges small — big pulls use the script).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Honour the paused flag + lookback window configured on the Sales Sync page.
  const cfg = await prisma.setting.findMany({ where: { key: { in: ["erp.schedule.paused", "erp.schedule.lookbackDays"] } } }).catch(() => []);
  const cfgMap = new Map(cfg.map((r) => [r.key, r.value]));
  if (cfgMap.get("erp.schedule.paused") === "1") {
    return NextResponse.json({ ok: true, skipped: true, reason: "Schedule is paused." });
  }
  const lookRaw = Number.parseInt(cfgMap.get("erp.schedule.lookbackDays") ?? "1", 10);
  const lookback = Number.isFinite(lookRaw) && lookRaw >= 1 ? Math.min(lookRaw, 30) : 1;

  const url = new URL(req.url);
  const to = url.searchParams.get("to") || dateIST(1); // yesterday
  const from = url.searchParams.get("from") || dateIST(lookback); // lookback window back from yesterday
  const res = await syncErpSales({ from, to, triggeredBy: "schedule:Scheduler" });
  return NextResponse.json({ ok: res.ok, runId: res.runId, from, to, rows: res.rows, bills: res.bills, newCustomers: res.newCustomers, lines: res.linesInserted, skipped: res.skipped, stores: res.stores, error: res.error });
}
