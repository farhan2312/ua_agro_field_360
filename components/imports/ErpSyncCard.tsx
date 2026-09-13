"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { runErpSyncNow, type ErpRunVM } from "@/app/actions/erp-sync";

const CARD = "rounded-[14px] border border-black/[0.04] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]";
const num = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-IN"));
// "2026-09-07" → "07-Sep-2026" (calendar date, formatted in UTC so it never shifts a day).
const fmtDay = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).replace(/ /g, "-");
};
const INPUT = "rounded-[8px] border border-[#E0E0E0] px-2.5 py-1.5 text-[13px] outline-none focus:border-[#2E7D32]";

const STATUS_STYLE: Record<string, { bg: string; c: string }> = {
  SUCCESS: { bg: "#E8F5E9", c: "#2E7D32" }, RUNNING: { bg: "#FFF8E1", c: "#8D6E00" }, FAILED: { bg: "#FDECEA", c: "#C62828" },
};

interface Summary { rows?: number; bills?: number; newCustomers?: number; linesInserted?: number; stores?: number }

export function ErpSyncCard({ initialRuns, defaultDate }: { initialRuns: ErpRunVM[]; defaultDate: string }) {
  const router = useRouter();
  const [from, setFrom] = useState(defaultDate);
  const [to, setTo] = useState(defaultDate);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sync = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await runErpSyncNow({ from, to });
      if (!r.ok) { setError(r.error ?? "Sync failed."); }
      else { setResult({ rows: r.rows, bills: r.bills, newCustomers: r.newCustomers, linesInserted: r.linesInserted, stores: r.stores }); }
      router.refresh(); // refresh the recent-runs table
    } catch (e) { setError(e instanceof Error ? e.message : "Sync failed."); }
    finally { setBusy(false); }
  };

  return (
    <div className={`${CARD} p-[22px]`}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <div className="text-[15px] font-bold text-[#1A1C1A]">ERP Sales Sync</div>
        <span className="rounded-full bg-[#E8F5E9] px-2 py-0.5 text-[10.5px] font-bold text-[#2E7D32]">LIVE FEED</span>
      </div>
      <div className="mb-4 text-[12.5px] leading-[1.6] text-[#616161]">
        Pulls sales straight from the ERP (all stores). Runs automatically every day ~2:00 AM IST for the
        previous day. Use this to run it on demand — a day (default yesterday) or a small date range.
        Re-running a date safely <b>replaces</b> that window&apos;s sales.
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-[0.4px] text-[#9E9E9E]">From</label>
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={INPUT} />
        </div>
        <div>
          <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-[0.4px] text-[#9E9E9E]">To</label>
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={INPUT} />
        </div>
        <button type="button" onClick={sync} disabled={busy || !from || !to}
          className="inline-flex items-center gap-2 rounded-[10px] bg-[#1B5E20] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#2E7D32] disabled:opacity-50">
          {busy ? (<><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />Syncing…</>) : (<><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5" /></svg>Sync now</>)}
        </button>
        {busy && <span className="text-[11.5px] text-[#9E9E9E]">Fetching from ERP + importing — keep this tab open.</span>}
      </div>

      {result && (
        <div className="mt-4 rounded-[12px] border border-[#A5D6A7] bg-[#E8F5E9] px-4 py-3">
          <div className="mb-1.5 text-[13px] font-bold text-[#2E7D32]">✓ Sync complete</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-[#33691E] sm:grid-cols-3">
            <div>Line rows: <b>{num(result.rows)}</b></div>
            <div>Bills: <b>{num(result.bills)}</b></div>
            <div>Sale lines: <b>{num(result.linesInserted)}</b></div>
            <div>New customers: <b>{num(result.newCustomers)}</b></div>
            <div>Stores: <b>{num(result.stores)}</b></div>
          </div>
        </div>
      )}
      {error && <div className="mt-4 rounded-[12px] border border-[#F5C6C6] bg-[#FDECEA] px-4 py-3 text-[12.5px] font-medium text-[#C62828]">{error}</div>}

      {/* Recent runs */}
      {initialRuns.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.5px] text-[#9E9E9E]">Recent syncs</div>
          <div className="overflow-x-auto rounded-[10px] border border-[#F0F0F0]">
            <table className="w-full min-w-[620px] text-left text-[12px]">
              <thead><tr className="border-b border-[#EEE] bg-[#FAFAFA] text-[10px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]">
                <th className="px-3 py-2">When</th><th>Window</th><th>By</th><th className="text-right">Rows</th><th className="text-right">Bills</th><th className="text-right">Lines</th><th className="text-right">New</th><th>Status</th>
              </tr></thead>
              <tbody>
                {initialRuns.map((r) => {
                  const st = STATUS_STYLE[r.status] ?? { bg: "#F5F5F5", c: "#616161" };
                  return (
                    <tr key={r.id} className="border-b border-[#F6F6F6] last:border-0">
                      <td className="px-3 py-2 text-[#616161]">{r.when}</td>
                      <td className="whitespace-nowrap text-[#616161]">{r.fromDate === r.toDate ? fmtDay(r.fromDate) : `${fmtDay(r.fromDate)} – ${fmtDay(r.toDate)}`}</td>
                      <td className="max-w-[130px] truncate text-[#9E9E9E]" title={r.triggeredBy ?? ""}>{(r.triggeredBy ?? "").replace("manual:", "")}</td>
                      <td className="text-right tabular-nums">{num(r.rows)}</td>
                      <td className="text-right tabular-nums">{num(r.bills)}</td>
                      <td className="text-right tabular-nums font-semibold text-[#2E7D32]">{num(r.linesInserted)}</td>
                      <td className="text-right tabular-nums">{num(r.newCustomers)}</td>
                      <td><span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: st.bg, color: st.c }}>{r.status}</span>{r.error && <span className="ml-1.5 text-[10px] text-[#C62828]" title={r.error}>!</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
