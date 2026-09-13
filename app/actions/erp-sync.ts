"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getRole } from "@/lib/session";
import { getActor } from "@/lib/scope";
import { syncErpSales } from "@/lib/erp-sales";

const DAY = 86_400_000, IST = 330 * 60_000;
const yesterdayIST = () => new Date(Date.now() + IST - DAY).toISOString().slice(0, 10);
const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());

export interface ErpRunVM {
  id: number; fromDate: string; toDate: string; status: string;
  rows: number | null; bills: number | null; newCustomers: number | null; linesInserted: number | null; stores: number | null;
  triggeredBy: string | null; error: string | null; durationMs: number | null; when: string;
}

/** Run an ERP sales sync on demand (sysadmin). Defaults to yesterday; keep custom ranges small.
 *  Gated behind a static password (env ERP_SYNC_PASSWORD) so sysadmins can't fire it casually — the
 *  check is here on the server so calling the action directly can't bypass the UI prompt. The daily
 *  cron does not use this; it authenticates with CRON_SECRET. */
export async function runErpSyncNow(input?: { from?: string; to?: string; password?: string }): Promise<{ ok: boolean; runId?: number; rows?: number; bills?: number; newCustomers?: number; linesInserted?: number; stores?: number; error?: string }> {
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
  return { ok: res.ok, runId: res.runId, rows: res.rows, bills: res.bills, newCustomers: res.newCustomers, linesInserted: res.linesInserted, stores: res.stores, error: res.error };
}

export async function listErpSyncRuns(limit = 15): Promise<ErpRunVM[]> {
  if ((await getRole()) !== "sysadmin") return [];
  const rows = await prisma.erpSyncRun.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  return rows.map((r) => ({
    id: r.id, fromDate: r.fromDate, toDate: r.toDate, status: r.status,
    rows: r.rows, bills: r.bills, newCustomers: r.newCustomers, linesInserted: r.linesInserted, stores: r.stores,
    triggeredBy: r.triggeredBy, error: r.error, durationMs: r.durationMs,
    when: r.createdAt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }),
  }));
}
