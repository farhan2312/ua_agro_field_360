"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ConfirmDialog";
import { runErpSyncNow, rollbackErpRun, setErpSchedulePaused, setErpLookbackDays, type ErpDashboard, type ErpRunVM } from "@/app/actions/erp-sync";

const CARD = "rounded-[14px] border border-black/[0.04] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]";
const INPUT = "rounded-[8px] border border-[#E0E0E0] px-2.5 py-1.5 text-[13px] outline-none focus:border-[#2E7D32]";
const n = (x: number | null | undefined) => (x == null ? "—" : x.toLocaleString("en-IN"));
const fmtDay = (s: string) => { const d = new Date(`${s}T00:00:00Z`); return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }); };
const fmtDur = (ms: number | null) => (ms == null ? "—" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);

const TRIGGER_STYLE: Record<string, { bg: string; c: string; label: string }> = {
  schedule: { bg: "#EDE7F6", c: "#5E35B1", label: "scheduled" },
  manual: { bg: "#E3F2FD", c: "#1565C0", label: "manual" },
  backfill: { bg: "#FFF3E0", c: "#E65100", label: "backfill" },
};
const STATUS_STYLE: Record<string, { bg: string; c: string; label: string }> = {
  SUCCESS: { bg: "#E8F5E9", c: "#2E7D32", label: "success" },
  RUNNING: { bg: "#FFF8E1", c: "#8D6E00", label: "running" },
  FAILED: { bg: "#FDECEA", c: "#C62828", label: "failed" },
  ROLLED_BACK: { bg: "#F5F5F5", c: "#9E9E9E", label: "rolled back" },
};

interface Summary { rows?: number; bills?: number; newCustomers?: number; linesInserted?: number; skipped?: number; stores?: number }

/** Add days to a YYYY-MM-DD string (IST-anchored, no tz drift). */
const addDays = (ymd: string, d: number) => new Date(new Date(`${ymd}T00:00:00Z`).getTime() + d * 86_400_000).toISOString().slice(0, 10);

function Tile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className={`${CARD} px-4 py-3.5`}>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.4px] text-[#9E9E9E]">{label}</div>
      <div className="mt-1 text-[24px] font-bold leading-none tabular-nums" style={{ color: color ?? "#1A1C1A" }}>{value}</div>
      {sub && <div className="mt-1.5 text-[11px] text-[#9E9E9E]">{sub}</div>}
    </div>
  );
}

export function ErpSyncDashboard({ dash, defaultDate, todayIST }: { dash: ErpDashboard; defaultDate: string; todayIST: string }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [from, setFrom] = useState(defaultDate);
  const [to, setTo] = useState(defaultDate);
  const [password, setPassword] = useState("");
  const [preset, setPreset] = useState<string>("yesterday");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lookback, setLookback] = useState(dash.schedule.lookbackDays);
  const [, startTransition] = useTransition();
  const [rollingBack, setRollingBack] = useState<number | null>(null);

  const yesterday = addDays(todayIST, -1);
  const presets: [string, string, () => [string, string]][] = [
    ["yesterday", "Yesterday", () => [yesterday, yesterday]],
    ["last7", "Last 7 days", () => [addDays(todayIST, -7), yesterday]],
    ["month", "This month", () => [`${todayIST.slice(0, 7)}-01`, yesterday]],
    ["fy", "This FY", () => { const [y, m] = todayIST.split("-").map(Number); const fyStart = m >= 4 ? y : y - 1; return [`${fyStart}-04-01`, yesterday]; }],
  ];
  const applyPreset = (key: string) => { const p = presets.find((x) => x[0] === key); if (!p) return; const [f, t] = p[2](); setFrom(f); setTo(t); setPreset(key); };

  const sync = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await runErpSyncNow({ from, to, password });
      if (!r.ok) setError(r.error ?? "Sync failed.");
      else { setResult({ rows: r.rows, bills: r.bills, newCustomers: r.newCustomers, linesInserted: r.linesInserted, skipped: r.skipped, stores: r.stores }); setPassword(""); }
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Sync failed."); }
    finally { setBusy(false); }
  };

  const togglePause = () => startTransition(async () => { await setErpSchedulePaused(!dash.schedule.paused); router.refresh(); });
  const saveLookback = () => startTransition(async () => { await setErpLookbackDays(lookback); router.refresh(); });

  const onRollback = async (r: ErpRunVM) => {
    const ok = await confirm({
      title: "Roll back this sync?",
      message: (<span>This permanently deletes <b>all ERP sales</b> dated <b>{fmtDay(r.fromDate)} – {fmtDay(r.toDate)}</b> and re-computes affected segments.<br />Any other sync covering these dates is affected too. This cannot be undone.</span>),
      confirmLabel: "Roll back",
    });
    if (!ok) return;
    setRollingBack(r.id);
    try {
      const res = await rollbackErpRun(r.id);
      if (!res.ok) setError(res.error ?? "Rollback failed.");
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Rollback failed."); }
    finally { setRollingBack(null); }
  };

  const at = dash.allTime;
  const k = dash.kpi30;

  return (
    <div className="animate-[fadeUp_0.4s_ease-out]">
      {dialog}

      {/* ── ERP sales sync card ── */}
      <div className={`${CARD} mb-[18px] p-[22px]`}>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[15px] font-bold text-[#1A1C1A]">ERP sales sync</div>
          <span className="rounded-full px-2.5 py-0.5 text-[10.5px] font-bold" style={dash.apiConfigured ? { background: "#E8F5E9", color: "#2E7D32" } : { background: "#FDECEA", color: "#C62828" }}>
            {dash.apiConfigured ? "API connected" : "API not configured"}
          </span>
        </div>
        <div className="mb-4 text-[12.5px] leading-[1.6] text-[#616161]">
          Pulls invoice line-items from the ERP (all stores), creates new customers by mobile, tags crops &amp; coupons, and refreshes segments. Re-running a window is safe — that date range is <b>replaced</b>, never doubled.
        </div>

        {/* Daily schedule */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-[#F7F9F7] px-4 py-3">
          <div className="min-w-0">
            <div className="text-[12.5px] font-bold text-[#1A1C1A]">Daily schedule · 02:00 IST {dash.schedule.paused && <span className="ml-1 rounded-full bg-[#FDECEA] px-2 py-0.5 text-[10px] font-bold text-[#C62828]">PAUSED</span>}</div>
            <div className="mt-0.5 text-[11.5px] text-[#616161]">
              Fetches the last {dash.schedule.lookbackDays} day{dash.schedule.lookbackDays > 1 ? "s" : ""} automatically.
              {dash.lastRun && <> Last run {dash.lastRun.when} · <span style={{ color: STATUS_STYLE[dash.lastRun.status]?.c ?? "#616161" }}>{STATUS_STYLE[dash.lastRun.status]?.label ?? dash.lastRun.status}</span> · {n(dash.lastRun.bills)} bills, {n(dash.lastRun.newCustomers)} new customers</>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-[#9E9E9E]">Lookback</label>
            <input type="number" min={1} max={30} value={lookback} onChange={(e) => setLookback(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} onBlur={saveLookback} className={`${INPUT} w-[64px]`} />
            <span className="text-[11px] text-[#9E9E9E]">day(s)</span>
            <button type="button" onClick={togglePause} className="rounded-[8px] border border-[#E0E0E0] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#616161] hover:bg-[#F5F5F5]">
              {dash.schedule.paused ? "Resume schedule" : "Pause schedule"}
            </button>
          </div>
        </div>

        {/* Run on demand */}
        <div className="text-[10.5px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]">Run on demand</div>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-[0.4px] text-[#9E9E9E]">From</label>
            <input type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPreset(""); }} className={INPUT} />
          </div>
          <div>
            <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-[0.4px] text-[#9E9E9E]">To</label>
            <input type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPreset(""); }} className={INPUT} />
          </div>
          <div className="flex items-center gap-1.5 pb-0.5">
            {presets.map(([key, label]) => (
              <button key={key} type="button" onClick={() => applyPreset(key)}
                className="rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors"
                style={preset === key ? { background: "#E8F5E9", color: "#1B5E20" } : { background: "#F5F5F5", color: "#757575" }}>
                {label}
              </button>
            ))}
          </div>
          <div>
            <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-[0.4px] text-[#9E9E9E]">Sync password</label>
            <input type="password" value={password} autoComplete="off" placeholder="Required" onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && from && to && password && !busy) sync(); }} className={`${INPUT} w-[130px]`} />
          </div>
          <button type="button" onClick={sync} disabled={busy || !from || !to || !password}
            className="inline-flex items-center gap-2 rounded-[10px] bg-[#1B5E20] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#2E7D32] disabled:opacity-50">
            {busy ? (<><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />Syncing…</>) : (<><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5" /></svg>Run sync now</>)}
          </button>
          {busy && <span className="pb-2 text-[11.5px] text-[#9E9E9E]">Fetching from ERP + importing — keep this tab open.</span>}
        </div>

        {result && (
          <div className="mt-4 rounded-[12px] border border-[#A5D6A7] bg-[#E8F5E9] px-4 py-3">
            <div className="mb-1.5 text-[13px] font-bold text-[#2E7D32]">✓ Sync complete</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-[#33691E] sm:grid-cols-3">
              <div>Line rows: <b>{n(result.rows)}</b></div><div>Bills: <b>{n(result.bills)}</b></div><div>Sale lines: <b>{n(result.linesInserted)}</b></div>
              <div>New customers: <b>{n(result.newCustomers)}</b></div><div>Skipped: <b>{n(result.skipped)}</b></div><div>Stores: <b>{n(result.stores)}</b></div>
            </div>
          </div>
        )}
        {error && <div className="mt-4 rounded-[12px] border border-[#F5C6C6] bg-[#FDECEA] px-4 py-3 text-[12.5px] font-medium text-[#C62828]">{error}</div>}
      </div>

      {/* ── KPI tiles ── */}
      <div className="mb-[18px] grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Tile label="Runs · 30 days" value={n(k.runs)} sub={`${k.succeeded} ok · ${k.failed} failed`} />
        <Tile label="Line-items · 30 days" value={n(k.lineItems)} sub="fetched from ERP" color="#2E7D32" />
        <Tile label="Bills · 30 days" value={n(k.bills)} sub="written to Farmer 360" color="#2E7D32" />
        <Tile label="New customers · 30 days" value={n(k.newCustomers)} sub="farmers created by mobile" color="#1565C0" />
        <Tile label="Avg run time" value={fmtDur(k.avgRunMs)} sub="per run, 30 days" color="#6A1B9A" />
        <Tile label="All-time in DB" value={n(at.bills)} sub={`${n(at.lines)} lines · ${n(at.farmers)} farmers${at.through ? ` · to ${fmtDay(at.through)}` : ""}`} color="#1B5E20" />
      </div>

      {/* ── Charts ── */}
      <div className="mb-[18px] grid grid-cols-1 gap-[18px] lg:grid-cols-2">
        <ActivityChart activity={dash.activity} todayIST={todayIST} />
        <CoverageHeatmap coverage={dash.coverage} todayIST={todayIST} />
      </div>

      {/* ── Run log ── */}
      <div className={`${CARD} overflow-hidden`}>
        <div className="flex items-center justify-between border-b border-[#F0F0F0] px-[22px] py-3.5">
          <div className="text-[15px] font-bold text-[#1A1C1A]">Run log</div>
          <span className="text-[11px] text-[#9E9E9E]">{dash.runs.length} most recent</span>
        </div>
        {dash.runs.length === 0 ? (
          <div className="px-[22px] py-12 text-center text-[13px] text-[#9E9E9E]">No syncs yet — run one above or wait for the daily schedule.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-[12px]">
              <thead><tr className="border-b border-[#EEE] bg-[#FAFAFA] text-[10px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]">
                <th className="px-[22px] py-2.5">Started</th><th>Trigger</th><th>Window</th><th>Status</th>
                <th className="text-right">Line-items</th><th className="text-right">Bills</th><th className="text-right">New cust.</th><th className="text-right">Skipped</th><th className="text-right">Duration</th><th>By</th><th />
              </tr></thead>
              <tbody>
                {dash.runs.map((r) => {
                  const tg = TRIGGER_STYLE[r.trigger]; const st = STATUS_STYLE[r.status] ?? { bg: "#F5F5F5", c: "#616161", label: r.status };
                  const canRoll = r.status === "SUCCESS";
                  return (
                    <tr key={r.id} className="border-b border-[#F6F6F6] last:border-0">
                      <td className="px-[22px] py-2.5 text-[#616161]">{r.when}</td>
                      <td><span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: tg.bg, color: tg.c }}>{tg.label}</span></td>
                      <td className="whitespace-nowrap text-[#616161]">{r.fromDate === r.toDate ? fmtDay(r.fromDate) : `${fmtDay(r.fromDate)} → ${fmtDay(r.toDate)}`}</td>
                      <td><span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: st.bg, color: st.c }}>{st.label}</span>{r.error && <span className="ml-1.5 cursor-help text-[10px] text-[#C62828]" title={r.error}>!</span>}</td>
                      <td className="text-right tabular-nums">{n(r.rows)}</td>
                      <td className="text-right tabular-nums font-semibold text-[#1A1C1A]">{n(r.bills)}</td>
                      <td className="text-right tabular-nums">{n(r.newCustomers)}</td>
                      <td className="text-right tabular-nums text-[#9E9E9E]">{n(r.skipped)}</td>
                      <td className="text-right tabular-nums text-[#616161]">{fmtDur(r.durationMs)}</td>
                      <td className="max-w-[140px] truncate text-[#9E9E9E]" title={r.by}>{r.by}</td>
                      <td className="pr-[22px] text-right">
                        {canRoll ? (
                          <button type="button" onClick={() => onRollback(r)} disabled={rollingBack === r.id}
                            className="rounded-[8px] border border-[#F0D0D0] px-2.5 py-1 text-[11px] font-semibold text-[#C62828] hover:bg-[#FDECEA] disabled:opacity-50">
                            {rollingBack === r.id ? "Rolling…" : "Roll back"}
                          </button>
                        ) : <span className="text-[10.5px] text-[#BDBDBD]">{r.status === "ROLLED_BACK" ? "rolled back" : "—"}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Sync activity bar chart (bills synced per run-day, last 30 days) ── */
function ActivityChart({ activity, todayIST }: { activity: { date: string; bills: number; failed: number }[]; todayIST: string }) {
  const days = useMemo(() => {
    const map = new Map(activity.map((a) => [a.date, a]));
    return Array.from({ length: 30 }, (_, i) => { const d = addDays(todayIST, -(29 - i)); const a = map.get(d); return { date: d, bills: a?.bills ?? 0, failed: a?.failed ?? 0 }; });
  }, [activity, todayIST]);
  const max = Math.max(1, ...days.map((d) => d.bills));
  const H = 130, W = 30, gap = 4;
  return (
    <div className={`${CARD} p-[22px]`}>
      <div className="mb-1 text-[13px] font-bold text-[#1A1C1A]">Sync activity · last 30 days</div>
      <div className="mb-3 text-[11px] text-[#9E9E9E]">Bills written per day the sync ran (a backfill shows as one tall bar).</div>
      <div className="overflow-x-auto">
        <svg width={days.length * (W + gap)} height={H + 22} className="block">
          {days.map((d, i) => {
            const bh = d.bills > 0 ? Math.max(2, (d.bills / max) * H) : 0;
            const x = i * (W + gap);
            const showLabel = i % 7 === 0 || i === days.length - 1;
            return (
              <g key={d.date}>
                {bh > 0 && <rect x={x} y={H - bh + 4} width={W} height={bh} rx={2} fill={d.failed > 0 ? "#EF9A9A" : "#7CB342"}><title>{`${fmtDay(d.date)}: ${d.bills.toLocaleString("en-IN")} bills${d.failed ? ` · ${d.failed} failed` : ""}`}</title></rect>}
                {d.failed > 0 && <circle cx={x + W / 2} cy={H - bh - 2} r={2.5} fill="#C62828" />}
                {showLabel && <text x={x + W / 2} y={H + 17} textAnchor="middle" fontSize={8.5} className="fill-[#9E9E9E]">{fmtDay(d.date).slice(0, 6)}</text>}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/* ── Bill-date coverage heatmap (line-items per bill date, last 60 days) ── */
function CoverageHeatmap({ coverage, todayIST }: { coverage: { date: string; lines: number }[]; todayIST: string }) {
  const days = useMemo(() => {
    const map = new Map(coverage.map((c) => [c.date, c.lines]));
    return Array.from({ length: 60 }, (_, i) => { const d = addDays(todayIST, -(59 - i)); return { date: d, lines: map.get(d) ?? 0 }; });
  }, [coverage, todayIST]);
  const max = Math.max(1, ...days.map((d) => d.lines));
  const shade = (lines: number) => { if (lines === 0) return "#EEEEEE"; const t = 0.25 + 0.75 * (lines / max); return `rgba(46,125,50,${t.toFixed(2)})`; };
  const empties = days.filter((d) => d.lines === 0).length;
  return (
    <div className={`${CARD} p-[22px]`}>
      <div className="mb-1 text-[13px] font-bold text-[#1A1C1A]">Bill-date coverage · last 60 days</div>
      <div className="mb-3 text-[11px] text-[#9E9E9E]">Line-items held per bill date. An empty cell is a day with no sales on record — a gap to re-fetch, or a genuinely quiet day.</div>
      <div className="flex flex-wrap gap-[3px]">
        {days.map((d) => (
          <div key={d.date} className="h-[15px] w-[15px] rounded-[3px]" style={{ background: shade(d.lines) }} title={`${fmtDay(d.date)}: ${d.lines.toLocaleString("en-IN")} line-items`} />
        ))}
      </div>
      <div className="mt-3 text-[11px] text-[#9E9E9E]">{empties} of 60 days have no sales on record.</div>
    </div>
  );
}
