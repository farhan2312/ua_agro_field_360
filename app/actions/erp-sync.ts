"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getRole } from "@/lib/session";
import { getActor } from "@/lib/scope";
import { syncErpSales } from "@/lib/erp-sales";
import { recomputeSegments } from "@/lib/segment-engine";

const DAY = 86_400_000, IST = 330 * 60_000;
const yesterdayIST = () => new Date(Date.now() + IST - DAY).toISOString().slice(0, 10);
const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());

/** Split triggeredBy ("<type>:<by>") into a badge type + a display name for the run log. */
function parseTrigger(raw: string | null): { type: "schedule" | "manual" | "backfill"; by: string } {
  const s = (raw ?? "").trim();
  const [head, ...rest] = s.split(":");
  const tail = rest.join(":").trim();
  if (head === "manual") return { type: "manual", by: tail || "Admin" };
  if (head === "backfill") return { type: "backfill", by: tail || "CLI" };
  if (head === "schedule" || head === "cron" || head === "scheduled") return { type: "schedule", by: tail || "Scheduler" };
  // Legacy rows: bare "manual:<name>" handled above; anything else defaults to manual.
  return { type: "manual", by: s || "—" };
}

export interface ErpRunVM {
  id: number; fromDate: string; toDate: string; status: string;
  rows: number | null; bills: number | null; newCustomers: number | null; linesInserted: number | null; skipped: number | null; stores: number | null;
  trigger: "schedule" | "manual" | "backfill"; by: string; error: string | null; durationMs: number | null; when: string;
}

function toRunVM(r: {
  id: number; fromDate: string; toDate: string; status: string; rows: number | null; bills: number | null;
  newCustomers: number | null; linesInserted: number | null; skipped: number | null; stores: number | null;
  triggeredBy: string | null; error: string | null; durationMs: number | null; createdAt: Date;
}): ErpRunVM {
  const t = parseTrigger(r.triggeredBy);
  return {
    id: r.id, fromDate: r.fromDate, toDate: r.toDate, status: r.status,
    rows: r.rows, bills: r.bills, newCustomers: r.newCustomers, linesInserted: r.linesInserted, skipped: r.skipped, stores: r.stores,
    trigger: t.type, by: t.by, error: r.error, durationMs: r.durationMs,
    when: r.createdAt.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }),
  };
}

/** Run an ERP sales sync on demand (sysadmin). Defaults to yesterday; keep custom ranges small.
 *  Gated behind a static password (env ERP_SYNC_PASSWORD) so sysadmins can't fire it casually — the
 *  check is here on the server so calling the action directly can't bypass the UI prompt. The daily
 *  cron does not use this; it authenticates with CRON_SECRET. */
export async function runErpSyncNow(input?: { from?: string; to?: string; password?: string }): Promise<{ ok: boolean; runId?: number; rows?: number; bills?: number; newCustomers?: number; linesInserted?: number; skipped?: number; stores?: number; error?: string }> {
  if ((await getRole()) !== "sysadmin") return { ok: false, error: "System admins only." };
  const required = (process.env.ERP_SYNC_PASSWORD || "").trim();
  if (!required) return { ok: false, error: "Manual sync is locked: set the ERP_SYNC_PASSWORD env var to enable it." };
  if ((input?.password || "").trim() !== required) return { ok: false, error: "Incorrect sync password." };
  const to = (input?.to || "").trim() || yesterdayIST();
  const from = (input?.from || "").trim() || to;
  if (!isYmd(from) || !isYmd(to)) return { ok: false, error: "Dates must be YYYY-MM-DD." };
  if (from > to) return { ok: false, error: "Start date must be on or before end date." };
  const actor = await getActor();
  const res = await syncErpSales({ from, to, triggeredBy: `manual:${actor.name}` });
  revalidatePath("/imports");
  return { ok: res.ok, runId: res.runId, rows: res.rows, bills: res.bills, newCustomers: res.newCustomers, linesInserted: res.linesInserted, skipped: res.skipped, stores: res.stores, error: res.error };
}

export async function listErpSyncRuns(limit = 15): Promise<ErpRunVM[]> {
  if ((await getRole()) !== "sysadmin") return [];
  const rows = await prisma.erpSyncRun.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  return rows.map(toRunVM);
}

/** Roll back one sync run: delete all REAL sales in that run's date window, then recompute segments.
 *  Destructive — the window is deleted regardless of which run wrote it (delete-by-window semantics),
 *  so overlapping runs share the window. Marks the run ROLLED_BACK. */
export async function rollbackErpRun(runId: number): Promise<{ ok: boolean; salesDeleted?: number; linesDeleted?: number; error?: string }> {
  if ((await getRole()) !== "sysadmin") return { ok: false, error: "System admins only." };
  const run = await prisma.erpSyncRun.findUnique({ where: { id: runId } });
  if (!run) return { ok: false, error: "Run not found." };
  if (run.status === "ROLLED_BACK") return { ok: false, error: "This run has already been rolled back." };
  if (!isYmd(run.fromDate) || !isYmd(run.toDate)) return { ok: false, error: "Run has no valid date window." };
  const fromDt = new Date(`${run.fromDate}T00:00:00Z`);
  const toDt = new Date(`${run.toDate}T23:59:59.999Z`);
  const win = { source: "REAL" as const, soldAt: { gte: fromDt, lte: toDt } };
  try {
    // Farmers whose sales are about to vanish — recompute just those (bounded, fast).
    const affected = await prisma.saleLine.findMany({ where: win, select: { farmerId: true }, distinct: ["farmerId"] });
    const farmerIds = affected.map((a) => a.farmerId).filter((x): x is number => x != null);
    const lines = await prisma.saleLine.deleteMany({ where: win });
    const sales = await prisma.sale.deleteMany({ where: win });
    await prisma.erpSyncRun.update({ where: { id: runId }, data: { status: "ROLLED_BACK" } });
    if (farmerIds.length) { try { await recomputeSegments({ farmerIds }); } catch { /* best-effort */ } }
    revalidatePath("/imports");
    return { ok: true, salesDeleted: sales.count, linesDeleted: lines.count };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Rollback failed." };
  }
}

/* ── Daily-schedule config (stored in Setting; honoured by the cron route) ── */
const K_PAUSED = "erp.schedule.paused";
const K_LOOKBACK = "erp.schedule.lookbackDays";

export interface ErpSchedule { paused: boolean; lookbackDays: number }

export async function getErpSchedule(): Promise<ErpSchedule> {
  const rows = await prisma.setting.findMany({ where: { key: { in: [K_PAUSED, K_LOOKBACK] } } });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const lookback = Number.parseInt(map.get(K_LOOKBACK) ?? "1", 10);
  return { paused: map.get(K_PAUSED) === "1", lookbackDays: Number.isFinite(lookback) && lookback >= 1 ? Math.min(lookback, 30) : 1 };
}

export async function setErpSchedulePaused(paused: boolean): Promise<{ ok: boolean; error?: string }> {
  if ((await getRole()) !== "sysadmin") return { ok: false, error: "System admins only." };
  await prisma.setting.upsert({ where: { key: K_PAUSED }, update: { value: paused ? "1" : "0" }, create: { key: K_PAUSED, value: paused ? "1" : "0" } });
  revalidatePath("/imports");
  return { ok: true };
}

export async function setErpLookbackDays(days: number): Promise<{ ok: boolean; error?: string }> {
  if ((await getRole()) !== "sysadmin") return { ok: false, error: "System admins only." };
  const d = Math.max(1, Math.min(30, Math.round(days)));
  await prisma.setting.upsert({ where: { key: K_LOOKBACK }, update: { value: String(d) }, create: { key: K_LOOKBACK, value: String(d) } });
  revalidatePath("/imports");
  return { ok: true };
}

/* ── Dashboard aggregates ── */
export interface ErpDashboard {
  schedule: ErpSchedule;
  apiConfigured: boolean;
  lastRun: { when: string; status: string; bills: number | null; newCustomers: number | null } | null;
  kpi30: { runs: number; succeeded: number; failed: number; lineItems: number; bills: number; newCustomers: number; avgRunMs: number };
  allTime: { bills: number; lines: number; farmers: number; through: string | null };
  activity: { date: string; bills: number; failed: number }[]; // last 30 days, by run date (IST)
  coverage: { date: string; lines: number }[];                  // last 60 days, by bill date
  runs: ErpRunVM[];
}

export async function getErpDashboard(): Promise<ErpDashboard | null> {
  if ((await getRole()) !== "sysadmin") return null;
  const since30 = new Date(Date.now() - 30 * DAY);

  const [schedule, last, runs30, runRows, billsAT, linesAT, farmersAT, throughAT, activity, coverage] = await Promise.all([
    getErpSchedule(),
    prisma.erpSyncRun.findFirst({ orderBy: { createdAt: "desc" } }),
    prisma.erpSyncRun.findMany({ where: { createdAt: { gte: since30 } }, select: { status: true, rows: true, bills: true, newCustomers: true, durationMs: true } }),
    prisma.erpSyncRun.findMany({ orderBy: { createdAt: "desc" }, take: 12 }),
    prisma.sale.count({ where: { source: "REAL" } }),
    prisma.saleLine.count({ where: { source: "REAL" } }),
    prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(DISTINCT "farmerId")::int n FROM "Sale" WHERE source='REAL' AND "farmerId" IS NOT NULL`),
    prisma.sale.aggregate({ where: { source: "REAL" }, _max: { soldAt: true } }),
    prisma.$queryRaw<{ d: string; bills: number; failed: number }[]>(Prisma.sql`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD') d,
             COALESCE(SUM("bills"),0)::int bills, COUNT(*) FILTER (WHERE status='FAILED')::int failed
      FROM "ErpSyncRun" WHERE "createdAt" >= now() - interval '30 days' GROUP BY 1 ORDER BY 1`),
    prisma.$queryRaw<{ d: string; n: number }[]>(Prisma.sql`
      SELECT to_char("soldAt",'YYYY-MM-DD') d, COUNT(*)::int n
      FROM "SaleLine" WHERE source='REAL' AND "soldAt" >= now() - interval '60 days' GROUP BY 1 ORDER BY 1`),
  ]);

  const durs = runs30.map((r) => r.durationMs).filter((x): x is number => x != null && x > 0);
  const kpi30 = {
    runs: runs30.length,
    succeeded: runs30.filter((r) => r.status === "SUCCESS").length,
    failed: runs30.filter((r) => r.status === "FAILED").length,
    lineItems: runs30.reduce((s, r) => s + (r.rows ?? 0), 0),
    bills: runs30.reduce((s, r) => s + (r.bills ?? 0), 0),
    newCustomers: runs30.reduce((s, r) => s + (r.newCustomers ?? 0), 0),
    avgRunMs: durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0,
  };

  const through = throughAT._max.soldAt;
  return {
    schedule,
    apiConfigured: !!process.env.SALES_API_TOKEN,
    lastRun: last ? { when: last.createdAt.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }), status: last.status, bills: last.bills, newCustomers: last.newCustomers } : null,
    kpi30,
    allTime: { bills: billsAT, lines: linesAT, farmers: farmersAT[0]?.n ?? 0, through: through ? through.toISOString().slice(0, 10) : null },
    activity: activity.map((a) => ({ date: a.d, bills: a.bills, failed: a.failed })),
    coverage: coverage.map((c) => ({ date: c.d, lines: c.n })),
    runs: runRows.map(toRunVM),
  };
}
