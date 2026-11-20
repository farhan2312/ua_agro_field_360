"use client";

// Round-by-round campaign analytics (Analytics modal → "🔁 Rounds" tab, plus the round strip on Overview).
// Data: getCampaignRoundAnalytics — finished rounds come from the per-round snapshots taken on advance,
// the current round from the live outcome. Every round colour is paired with its "R1/R2" label.
import { useMemo, useState } from "react";
import { cropLabel } from "@/lib/crops";
import { inr } from "@/lib/format";
import type { RoundAnalytics, RoundCat, RoundMeta, RoundStat, RoundGeoRow } from "@/app/actions/campaigns";

const CARD = "rounded-[14px] border border-black/[0.04] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]";
const n = (x: number) => x.toLocaleString("en-IN");
const pct = (x: number, t: number) => (t > 0 ? (x / t) * 100 : 0);
const p1 = (v: number) => `${Math.round(v * 10) / 10}%`;
export const ROUND_COLORS = ["#1565C0", "#E65100", "#6A1B9A", "#00838F", "#AD1457", "#5D4037"];
export const roundColor = (ord: number) => ROUND_COLORS[(ord - 1) % ROUND_COLORS.length];
const CATS: RoundCat[] = ["INTERESTED", "NOT_INTERESTED", "OTHER_CROP", "REACHED", "UNREACHABLE", "NONE"];
const REACHED_CATS: RoundCat[] = ["INTERESTED", "NOT_INTERESTED", "OTHER_CROP", "REACHED"];
const CAT_LABEL: Record<RoundCat, string> = {
  INTERESTED: "Interested", NOT_INTERESTED: "Not interested", OTHER_CROP: "Wants another crop",
  REACHED: "Reached, no response", UNREACHABLE: "Unreachable", NONE: "Not contacted",
};
const CAT_COLOR: Record<RoundCat, string> = {
  INTERESTED: "#2E7D32", NOT_INTERESTED: "#C62828", OTHER_CROP: "#E65100", REACHED: "#1565C0", UNREACHABLE: "#757575", NONE: "#BDBDBD",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtD = (iso: string) => { const [, m, d] = iso.split("-").map(Number); return `${d} ${MONTHS[m - 1]}`; };
function hexA(hex: string, a: number) {
  const h = hex.replace("#", ""); const v = parseInt(h, 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

export function RoundBadge({ ord, small }: { ord: number; small?: boolean }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-[6px] font-bold text-white ${small ? "px-1.5 py-[1px] text-[10px]" : "px-2 py-0.5 text-[11px]"}`}
      style={{ background: roundColor(ord) }}>R{ord}</span>
  );
}

function StatusChip({ r }: { r: RoundMeta }) {
  if (r.status === "done") return <span className="rounded-full bg-[#ECEFF1] px-2 py-0.5 text-[10.5px] font-semibold text-[#546E7A]">✓ Finished</span>;
  if (r.status === "upcoming") return <span className="rounded-full border border-dashed border-[#BDBDBD] px-2 py-0.5 text-[10.5px] font-semibold text-[#9E9E9E]">Upcoming</span>;
  return <span className="rounded-full bg-[#E0F7FA] px-2 py-0.5 text-[10.5px] font-semibold text-[#00838F]">● Current · day {r.dayNow} of {r.days}</span>;
}

/** Horizontal round timeline — one card per round with its headline numbers. Shown on Overview and on the Rounds tab. */
export function RoundStrip({ data, onOpen }: { data: RoundAnalytics; onOpen?: () => void }) {
  return (
    <div className={`${CARD} p-3.5`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px] font-bold text-[#1A1C1A]">Rounds</div>
        {onOpen && <button type="button" onClick={onOpen} className="text-[11.5px] font-semibold text-[#00838F] hover:underline">Round-by-round comparison →</button>}
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        {data.rounds.map((r) => {
          const s = data.stats.find((x) => x.ordinal === r.ordinal)!;
          const reachP = pct(s.reached, s.test);
          const up = r.status === "upcoming";
          return (
            <div key={r.ordinal} className="min-w-[210px] flex-1 rounded-[12px] border p-3"
              style={{ borderColor: r.status === "current" ? hexA(roundColor(r.ordinal), 0.45) : "#EEEEEE", background: up ? "#FAFAFA" : "#fff" }}>
              <div className="flex items-center gap-1.5">
                <RoundBadge ord={r.ordinal} />
                <span className="truncate text-[12.5px] font-bold text-[#1A1C1A]" title={r.name}>{r.name}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[#757575]">
                <span>{fmtD(r.start)} → {fmtD(r.end)}</span><StatusChip r={r} />
              </div>
              {up ? (
                <div className="mt-2.5 text-[11.5px] text-[#9E9E9E]">Starts {fmtD(r.start)}{r.coupons.length ? ` · coupons ${r.coupons.join(", ")}` : ""}</div>
              ) : (<>
                <div className="mt-2.5 flex items-baseline gap-1.5">
                  <span className="text-[18px] font-bold tabular-nums text-[#1A1C1A]">{n(s.reached)}</span>
                  <span className="text-[11.5px] text-[#757575]">reached · {p1(reachP)}</span>
                </div>
                <div className="mt-1 h-[6px] overflow-hidden rounded-full bg-[#F0F0F0]">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, reachP)}%`, background: roundColor(r.ordinal) }} />
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1 text-[10.5px] text-[#757575]">
                  <div><b className="block text-[12.5px] tabular-nums text-[#2E7D32]">{n(s.interested)}</b>interested</div>
                  <div><b className="block text-[12.5px] tabular-nums text-[#1565C0]">{n(s.buyersReached)}</b>reached bought</div>
                  <div>{s.couponRedeemers != null
                    ? <><b className="block text-[12.5px] tabular-nums text-[#6A1B9A]">{n(s.couponRedeemers)}</b>coupon used</>
                    : <><b className="block text-[12.5px] tabular-nums text-[#C62828]">{n(s.test - s.reached)}</b>pending</>}</div>
                </div>
              </>)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Round-by-round metric table with change vs the previous round ── */
type MetricRow = { label: string; hint?: string; get: (s: RoundStat) => number | null; kind: "count" | "pct" | "inr"; good?: "up" | "down" };
const METRIC_GROUPS: { title: string; rows: MetricRow[] }[] = [
  { title: "Outreach", rows: [
    { label: "Outcome recorded", hint: "any channel, unreachable or note", get: (s) => s.recorded, kind: "count", good: "up" },
    { label: "Reached", get: (s) => s.reached, kind: "count", good: "up" },
    { label: "Reached %", hint: "of test farmers", get: (s) => pct(s.reached, s.test), kind: "pct", good: "up" },
    { label: "Unreachable", get: (s) => s.unreachable, kind: "count", good: "down" },
    { label: "Still pending", hint: "not reached", get: (s) => s.test - s.reached, kind: "count", good: "down" },
    { label: "By call", get: (s) => s.call, kind: "count" },
    { label: "By WhatsApp", get: (s) => s.whatsapp, kind: "count" },
    { label: "By SMS", get: (s) => s.sms, kind: "count" },
    { label: "In person", get: (s) => s.inPerson, kind: "count" },
  ] },
  { title: "Response (share of reached)", rows: [
    { label: "Interested", get: (s) => pct(s.interested, s.reached), kind: "pct", good: "up" },
    { label: "Not interested", get: (s) => pct(s.notInterested, s.reached), kind: "pct", good: "down" },
    { label: "Wants another crop", get: (s) => pct(s.otherCrop, s.reached), kind: "pct" },
    { label: "No response logged", get: (s) => pct(s.noResponse, s.reached), kind: "pct", good: "down" },
  ] },
  { title: "Purchase in the round window", rows: [
    { label: "Reached who bought", get: (s) => s.buyersReached, kind: "count", good: "up" },
    { label: "Reached %buy", get: (s) => pct(s.buyersReached, s.reached), kind: "pct", good: "up" },
    { label: "Not reached %buy", get: (s) => pct(s.buyersNotReached, s.test - s.reached), kind: "pct" },
    { label: "Control %buy", hint: "holdout baseline", get: (s) => (s.control ? pct(s.buyersControl, s.control) : null), kind: "pct" },
    { label: "Lift vs control", hint: "reached %buy − control %buy", get: (s) => (s.control && s.reached ? pct(s.buyersReached, s.reached) - pct(s.buyersControl, s.control) : null), kind: "pct", good: "up" },
    { label: "Interested who bought", get: (s) => s.interestedBought, kind: "count", good: "up" },
    { label: "Sales by reached (base)", get: (s) => s.salesReached, kind: "inr", good: "up" },
  ] },
  { title: "Coupons", rows: [
    { label: "Coupon redeemers", get: (s) => s.couponRedeemers, kind: "count", good: "up" },
    { label: "Coupon revenue (base)", get: (s) => s.couponRevenue, kind: "inr", good: "up" },
  ] },
];
const fmtVal = (v: number | null, kind: MetricRow["kind"]) => (v == null ? "—" : kind === "pct" ? p1(v) : kind === "inr" ? inr(Math.round(v)) : n(Math.round(v)));

function CompareTable({ data }: { data: RoundAnalytics }) {
  const started = data.rounds.filter((r) => r.status !== "upcoming");
  const stat = (o: number) => data.stats.find((s) => s.ordinal === o)!;
  const last = started[started.length - 1], prev = started[started.length - 2];
  const hasCoupons = data.stats.some((s) => s.couponRedeemers != null);
  return (
    <div className={`${CARD} p-4`}>
      <div className="mb-1 text-[13px] font-bold text-[#1A1C1A]">Round by round</div>
      <div className="mb-2 text-[11px] text-[#9E9E9E]">
        Each round counts only what was recorded in that round. Purchases = {data.basisLabel}, bought between the round&apos;s start and end dates.
        {prev ? ` Change = R${last.ordinal} vs R${prev.ordinal}.` : ""}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-[#ECECEC] text-[10.5px] font-semibold uppercase tracking-[0.3px] text-[#757575]">
              <th className="px-2.5 py-1.5 text-left">Metric</th>
              {started.map((r) => (
                <th key={r.ordinal} className="px-2.5 py-1.5 text-right">
                  <span className="inline-flex items-center gap-1"><RoundBadge ord={r.ordinal} small />{r.status === "current" ? <span className="normal-case text-[#00838F]">now</span> : null}</span>
                </th>
              ))}
              {prev && <th className="px-2.5 py-1.5 text-right">Change</th>}
            </tr>
          </thead>
          <tbody>
            {METRIC_GROUPS.filter((g) => g.title !== "Coupons" || hasCoupons).map((g) => (
              <MetricGroup key={g.title} g={g} started={started} stat={stat} last={last} prev={prev} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function MetricGroup({ g, started, stat, last, prev }: { g: (typeof METRIC_GROUPS)[number]; started: RoundMeta[]; stat: (o: number) => RoundStat; last: RoundMeta; prev?: RoundMeta }) {
  return (<>
    <tr><td colSpan={started.length + 2} className="bg-[#FAFAFA] px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.3px] text-[#9E9E9E]">{g.title}</td></tr>
    {g.rows.map((m) => {
      const a = prev ? m.get(stat(prev.ordinal)) : null, b = m.get(stat(last.ordinal));
      const delta = a != null && b != null ? b - a : null;
      const better = delta == null || delta === 0 || !m.good ? null : (delta > 0) === (m.good === "up");
      return (
        <tr key={m.label} className="border-b border-[#F5F5F5]">
          <td className="px-2.5 py-1.5 text-[#424242]">{m.label}{m.hint && <span className="ml-1 text-[10.5px] text-[#BDBDBD]">{m.hint}</span>}</td>
          {started.map((r) => <td key={r.ordinal} className="px-2.5 py-1.5 text-right tabular-nums text-[#1A1C1A]">{fmtVal(m.get(stat(r.ordinal)), m.kind)}</td>)}
          {prev && (
            <td className="px-2.5 py-1.5 text-right tabular-nums font-semibold" style={{ color: better == null ? "#9E9E9E" : better ? "#2E7D32" : "#C62828" }}>
              {delta == null ? "—" : delta === 0 ? "0" : `${delta > 0 ? "▲ +" : "▼ −"}${m.kind === "pct" ? `${Math.round(Math.abs(delta) * 10) / 10} pts` : m.kind === "inr" ? inr(Math.round(Math.abs(delta))) : n(Math.round(Math.abs(delta)))}`}
            </td>
          )}
        </tr>
      );
    })}
  </>);
}

/* ── Pace: cumulative reached % by day of the round, one line per round ── */
function PaceChart({ data }: { data: RoundAnalytics }) {
  const started = data.rounds.filter((r) => r.status !== "upcoming");
  const test = data.stats[0]?.test ?? 0;
  const series = started.map((r) => {
    let c = 0;
    return { r, pts: (data.pace[r.ordinal] ?? []).map((v) => (c += v, pct(c, test))) };
  });
  const maxDays = Math.max(1, ...started.map((r) => r.days));
  const maxY = Math.max(10, Math.ceil(Math.max(0, ...series.flatMap((s) => s.pts)) / 10) * 10);
  const W = 640, H = 220, L = 36, R = 64, T = 12, B = 26;
  const x = (d: number) => L + ((d - 1) / Math.max(1, maxDays - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / maxY) * (H - T - B);
  const [hover, setHover] = useState<number | null>(null);
  const ticks = [0, maxY / 2, maxY];
  const xt = [...new Set([1, Math.ceil(maxDays / 2), maxDays])];
  return (
    <div className={`${CARD} p-4`}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px] font-bold text-[#1A1C1A]">Pace — reached % by day of the round</div>
        {series.length > 1 && (
          <div className="flex flex-wrap gap-2.5 text-[11px] text-[#616161]">
            {series.map((s) => <span key={s.r.ordinal} className="inline-flex items-center gap-1"><span className="inline-block h-[3px] w-3.5 rounded" style={{ background: roundColor(s.r.ordinal) }} />R{s.r.ordinal} {s.r.name}</span>)}
          </div>
        )}
      </div>
      <div className="mb-2 text-[11px] text-[#9E9E9E]">Compare how fast each round reaches farmers on the same day number. Uses the time each outcome was last recorded.</div>
      {series.every((s) => s.pts.length === 0) ? <div className="py-6 text-center text-[12px] text-[#BDBDBD]">No outreach recorded yet.</div> : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              const px = ((e.clientX - rect.left) / rect.width) * W;
              const d = Math.round(((px - L) / (W - L - R)) * (maxDays - 1)) + 1;
              setHover(d >= 1 && d <= maxDays ? d : null);
            }}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#EEEEEE" strokeWidth={1} />
                <text x={L - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill="#9E9E9E">{Math.round(t)}%</text>
              </g>
            ))}
            {xt.map((d) => <text key={d} x={x(d)} y={H - 8} textAnchor="middle" fontSize={10} fill="#9E9E9E">day {d}</text>)}
            {hover != null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="#BDBDBD" strokeDasharray="3 3" />}
            {series.map((s) => s.pts.length > 0 && (
              <g key={s.r.ordinal}>
                <polyline fill="none" stroke={roundColor(s.r.ordinal)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                  points={s.pts.map((v, i) => `${x(i + 1)},${y(v)}`).join(" ")} />
                <circle cx={x(s.pts.length)} cy={y(s.pts[s.pts.length - 1])} r={4} fill={roundColor(s.r.ordinal)} stroke="#fff" strokeWidth={2} />
                <text x={x(s.pts.length) + 7} y={y(s.pts[s.pts.length - 1]) + 3.5} fontSize={10.5} fontWeight={700} fill="#424242">R{s.r.ordinal} {p1(s.pts[s.pts.length - 1])}</text>
                {hover != null && hover <= s.pts.length && <circle cx={x(hover)} cy={y(s.pts[hover - 1])} r={4} fill={roundColor(s.r.ordinal)} stroke="#fff" strokeWidth={2} />}
              </g>
            ))}
          </svg>
          {hover != null && (
            <div className="pointer-events-none absolute top-1 rounded-[8px] border border-[#E0E0E0] bg-white px-2.5 py-1.5 text-[11px] shadow-[0_4px_14px_rgba(0,0,0,0.12)]"
              style={{ left: `${Math.min(70, (x(hover) / W) * 100)}%` }}>
              <div className="mb-0.5 font-semibold text-[#424242]">Day {hover}</div>
              {series.map((s) => (
                <div key={s.r.ordinal} className="flex items-center gap-1.5 text-[#616161]">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: roundColor(s.r.ordinal) }} />R{s.r.ordinal}:
                  <b className="tabular-nums text-[#1A1C1A]">{hover <= s.pts.length ? `${p1(s.pts[hover - 1])} · ${n(Math.round((s.pts[hover - 1] / 100) * test))}` : "—"}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Round → round flow: what happened in round B to the farmers of each round-A outcome ── */
function FlowCard({ data }: { data: RoundAnalytics }) {
  const started = data.rounds.filter((r) => r.status !== "upcoming");
  const [pair, setPair] = useState(() => {
    const t = data.transitions;
    const last = t.filter((x) => x.to === started[started.length - 1]?.ordinal).sort((a, b) => b.from - a.from)[0];
    return last ? `${last.from}-${last.to}` : "";
  });
  if (started.length < 2) {
    return (
      <div className={`${CARD} p-4`}>
        <div className="text-[13px] font-bold text-[#1A1C1A]">Round → round flow</div>
        <div className="mt-2 rounded-[10px] border border-dashed border-[#E0E0E0] bg-[#FAFAFA] px-3 py-4 text-[12px] text-[#757575]">
          Shows up once round 2 starts. You&apos;ll see, for each round 1 outcome (interested, not interested, unreachable, not contacted…), what happened to
          those farmers in round 2 and how many of them went on to buy — e.g. “interested in R1 → bought in R2”.
        </div>
      </div>
    );
  }
  const t = data.transitions.find((x) => `${x.from}-${x.to}` === pair) ?? data.transitions[data.transitions.length - 1];
  const rowTot = (c: RoundCat) => CATS.reduce((s, y) => s + t.cells[c][y], 0);
  const sumTo = (from: RoundCat[], to: RoundCat[]) => from.reduce((s, a) => s + to.reduce((ss, b) => ss + t.cells[a][b], 0), 0);
  const maxCell = Math.max(1, ...CATS.flatMap((a) => CATS.map((b) => t.cells[a][b])));
  const intTot = rowTot("INTERESTED");
  const callouts = [
    { label: `Interested in R${t.from} → bought in R${t.to}`, v: t.boughtTo.INTERESTED, of: intTot, color: "#2E7D32" },
    { label: `Unreachable in R${t.from} → reached in R${t.to}`, v: sumTo(["UNREACHABLE"], REACHED_CATS), of: rowTot("UNREACHABLE"), color: "#1565C0" },
    { label: `Not contacted in R${t.from} → reached in R${t.to}`, v: sumTo(["NONE"], REACHED_CATS), of: rowTot("NONE"), color: "#00838F" },
    { label: `Not interested in R${t.from} → interested in R${t.to}`, v: t.cells.NOT_INTERESTED.INTERESTED, of: rowTot("NOT_INTERESTED"), color: "#6A1B9A" },
    { label: `Reached in R${t.from}, not yet reached in R${t.to}`, v: sumTo(REACHED_CATS, ["UNREACHABLE", "NONE"]), of: REACHED_CATS.reduce((s, c) => s + rowTot(c), 0), color: "#C62828" },
  ];
  return (
    <div className={`${CARD} p-4`}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px] font-bold text-[#1A1C1A]">Round → round flow</div>
        {data.transitions.length > 1 && (
          <select value={`${t.from}-${t.to}`} onChange={(e) => setPair(e.target.value)} className="rounded-[8px] border border-[#E0E0E0] bg-white px-2 py-1 text-[12px] text-[#424242]">
            {data.transitions.map((x) => <option key={`${x.from}-${x.to}`} value={`${x.from}-${x.to}`}>R{x.from} → R{x.to}</option>)}
          </select>
        )}
      </div>
      <div className="mb-3 text-[11px] text-[#9E9E9E]">Rows = what the farmer said in R{t.from}; columns = what happened in R{t.to}. “Bought in R{t.to}” counts campaign-product purchases during R{t.to}.</div>
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {callouts.map((c) => (
          <div key={c.label} className="rounded-[10px] border border-[#EEEEEE] px-3 py-2">
            <div className="text-[11px] text-[#757575]">{c.label}</div>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span className="text-[17px] font-bold tabular-nums" style={{ color: c.color }}>{n(c.v)}</span>
              <span className="text-[11px] text-[#9E9E9E]">of {n(c.of)}{c.of ? ` · ${p1(pct(c.v, c.of))}` : ""}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-[11.5px]">
          <thead>
            <tr className="border-b border-[#ECECEC] text-[10px] font-semibold uppercase tracking-[0.3px] text-[#757575]">
              <th className="px-2 py-1.5 text-left"><span className="inline-flex items-center gap-1"><RoundBadge ord={t.from} small /> ↓ · <RoundBadge ord={t.to} small /> →</span></th>
              {CATS.map((c) => <th key={c} className="px-2 py-1.5 text-right" style={{ color: CAT_COLOR[c] === "#BDBDBD" ? "#9E9E9E" : CAT_COLOR[c] }}>{CAT_LABEL[c]}</th>)}
              <th className="border-l border-[#EEE] px-2 py-1.5 text-right text-[#1A1C1A]">Total</th>
              <th className="px-2 py-1.5 text-right text-[#1565C0]">Bought in R{t.to}</th>
            </tr>
          </thead>
          <tbody>
            {CATS.map((a) => {
              const tot = rowTot(a);
              return (
                <tr key={a} className="border-b border-[#F5F5F5]">
                  <td className="px-2 py-1.5 font-semibold" style={{ color: CAT_COLOR[a] === "#BDBDBD" ? "#757575" : CAT_COLOR[a] }}>{CAT_LABEL[a]}</td>
                  {CATS.map((b) => {
                    const v = t.cells[a][b];
                    return <td key={b} className="px-2 py-1.5 text-right tabular-nums" title={`${CAT_LABEL[a]} in R${t.from} → ${CAT_LABEL[b]} in R${t.to}: ${n(v)}`}
                      style={{ background: v ? hexA("#00838F", 0.06 + 0.5 * (v / maxCell)) : undefined, color: v ? "#1A1C1A" : "#DADADA", fontWeight: a === b ? 700 : 400 }}>{v ? n(v) : "·"}</td>;
                  })}
                  <td className="border-l border-[#EEE] px-2 py-1.5 text-right font-bold tabular-nums">{n(tot)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-[#1565C0]">{n(t.boughtTo[a])}{tot ? <span className="ml-1 text-[10px] text-[#9E9E9E]">{p1(pct(t.boughtTo[a], tot))}</span> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Centre / region / district / village × round, with change ── */
const GEO_DIMS = { store: "Centre", region: "Region", district: "District", village: "Village" } as const;
type GeoMetric = "reach" | "interested" | "bought";
const GEO_METRIC: Record<GeoMetric, string> = { reach: "Reached %", interested: "Interested %", bought: "Bought %" };
function GeoCompare({ data }: { data: RoundAnalytics }) {
  const started = data.rounds.filter((r) => r.status !== "upcoming");
  const [dim, setDim] = useState<keyof typeof GEO_DIMS>("store");
  const [metric, setMetric] = useState<GeoMetric>("reach");
  const [sortBy, setSortBy] = useState<"test" | "delta" | number>("test");
  const last = started[started.length - 1], prev = started[started.length - 2];
  const val = (g: RoundGeoRow, o: number) => {
    const c = g.r[o]; if (!c) return 0;
    return metric === "reach" ? pct(c.reached, g.test) : metric === "interested" ? pct(c.interested, c.reached) : pct(c.bought, g.test);
  };
  const rows = useMemo(() => {
    const list = [...data.geo[dim]];
    if (sortBy === "delta" && prev) list.sort((a, b) => (val(a, last.ordinal) - val(a, prev.ordinal)) - (val(b, last.ordinal) - val(b, prev.ordinal)));
    else if (typeof sortBy === "number") list.sort((a, b) => val(b, sortBy) - val(a, sortBy));
    return list;
  }, [data, dim, sortBy, metric]); // eslint-disable-line react-hooks/exhaustive-deps
  const Pill = <K extends string>({ k, cur, set, label }: { k: K; cur: K; set: (k: K) => void; label: string }) => (
    <button type="button" onClick={() => set(k)} className="rounded-[6px] px-2.5 py-1 text-[11.5px] font-semibold transition-colors"
      style={{ background: cur === k ? "#fff" : "transparent", color: cur === k ? "#00838F" : "#9E9E9E", boxShadow: cur === k ? "0 1px 2px rgba(0,0,0,0.1)" : "none" }}>{label}</button>
  );
  const sub = dim === "store" ? "Region" : dim === "village" ? "District" : null;
  return (
    <div className={`${CARD} p-4`}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px] font-bold text-[#1A1C1A]">{GEO_DIMS[dim]} × round</div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-[8px] border border-[#E0E0E0] bg-[#F5F7F5] p-0.5">
            {(Object.keys(GEO_METRIC) as GeoMetric[]).map((k) => <Pill key={k} k={k} cur={metric} set={setMetric} label={GEO_METRIC[k]} />)}
          </div>
          <div className="inline-flex rounded-[8px] border border-[#E0E0E0] bg-[#F5F7F5] p-0.5">
            {(Object.keys(GEO_DIMS) as (keyof typeof GEO_DIMS)[]).map((k) => <Pill key={k} k={k} cur={dim} set={setDim} label={GEO_DIMS[k]} />)}
          </div>
        </div>
      </div>
      <div className="mb-2 text-[11px] text-[#9E9E9E]">
        {metric === "reach" ? "Reached ÷ test farmers" : metric === "interested" ? "Interested ÷ reached" : "Bought campaign products in the round ÷ test farmers"} for each round.
        {prev ? " Click “Change” to see who slipped most; click a round to rank by it." : ""}{dim === "village" ? " Top 300 villages." : ""}
      </div>
      <div className="max-h-[440px] overflow-auto">
        <table className="w-full min-w-[520px] border-collapse text-[12px]">
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="border-b border-[#ECECEC] text-[10.5px] font-semibold uppercase tracking-[0.3px] text-[#757575]">
              <th className="px-2.5 py-1.5 text-left">{GEO_DIMS[dim]}</th>
              {sub && <th className="px-2.5 py-1.5 text-left">{sub}</th>}
              <th className="cursor-pointer px-2.5 py-1.5 text-right hover:text-[#00838F]" onClick={() => setSortBy("test")}>Test{sortBy === "test" ? " ▾" : ""}</th>
              {started.map((r) => (
                <th key={r.ordinal} className="cursor-pointer px-2.5 py-1.5 text-right hover:text-[#00838F]" onClick={() => setSortBy(r.ordinal)}>
                  <span className="inline-flex items-center gap-1"><RoundBadge ord={r.ordinal} small />{sortBy === r.ordinal ? "▾" : ""}</span>
                </th>
              ))}
              {prev && <th className="cursor-pointer px-2.5 py-1.5 text-right hover:text-[#00838F]" onClick={() => setSortBy("delta")}>Change{sortBy === "delta" ? " ▴" : ""}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => {
              const d = prev ? val(g, last.ordinal) - val(g, prev.ordinal) : 0;
              return (
                <tr key={`${g.label}|${g.sub}`} className="border-b border-[#F5F5F5]">
                  <td className="max-w-[200px] truncate px-2.5 py-1.5 font-semibold text-[#1A1C1A]" title={g.label}>{g.label}</td>
                  {sub && <td className="px-2.5 py-1.5 text-[11.5px] text-[#757575]">{g.sub || "—"}</td>}
                  <td className="px-2.5 py-1.5 text-right tabular-nums text-[#616161]">{n(g.test)}</td>
                  {started.map((r) => {
                    const v = val(g, r.ordinal);
                    const c = g.r[r.ordinal];
                    const cnt = !c ? 0 : metric === "reach" ? c.reached : metric === "interested" ? c.interested : c.bought;
                    return <td key={r.ordinal} className="px-2.5 py-1.5 text-right tabular-nums" title={`R${r.ordinal}: ${n(cnt)} farmers`}
                      style={{ background: v ? hexA(roundColor(r.ordinal), 0.05 + 0.4 * Math.min(1, v / 100)) : undefined, color: v ? "#1A1C1A" : "#BDBDBD" }}>
                      {p1(v)} <span className="text-[10px] text-[#9E9E9E]">{n(cnt)}</span>
                    </td>;
                  })}
                  {prev && <td className="px-2.5 py-1.5 text-right tabular-nums font-semibold" style={{ color: d > 0.05 ? "#2E7D32" : d < -0.05 ? "#C62828" : "#9E9E9E" }}>
                    {Math.abs(d) < 0.05 ? "0" : `${d > 0 ? "▲ +" : "▼ −"}${Math.round(Math.abs(d) * 10) / 10} pts`}
                  </td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Who recorded the outreach, per round ── */
function CallersCard({ data }: { data: RoundAnalytics }) {
  const started = data.rounds.filter((r) => r.status !== "upcoming");
  if (!data.callers.length) return null;
  return (
    <div className={`${CARD} p-4`}>
      <div className="mb-1 text-[13px] font-bold text-[#1A1C1A]">Who did the calling — by round</div>
      <div className="mb-2 text-[11px] text-[#9E9E9E]">Reached farmers recorded by each person (interested in brackets). Top 40 by outcomes recorded.</div>
      <div className="max-h-[360px] overflow-auto">
        <table className="w-full min-w-[420px] border-collapse text-[12px]">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-[#ECECEC] text-[10.5px] font-semibold uppercase tracking-[0.3px] text-[#757575]">
              <th className="px-2.5 py-1.5 text-left">Recorded by</th>
              {started.map((r) => <th key={r.ordinal} className="px-2.5 py-1.5 text-right"><RoundBadge ord={r.ordinal} small /></th>)}
              <th className="px-2.5 py-1.5 text-right">Total reached</th>
            </tr>
          </thead>
          <tbody>
            {data.callers.map((c) => {
              const tot = Object.values(c.r).reduce((s, x) => s + x.reached, 0);
              return (
                <tr key={c.name} className="border-b border-[#F5F5F5]">
                  <td className="max-w-[240px] truncate px-2.5 py-1.5 font-semibold text-[#1A1C1A]" title={c.name}>{c.name}</td>
                  {started.map((r) => {
                    const x = c.r[r.ordinal];
                    return <td key={r.ordinal} className="px-2.5 py-1.5 text-right tabular-nums text-[#424242]" title={x ? `${n(x.recorded)} outcomes recorded` : ""}>
                      {x ? <>{n(x.reached)} <span className="text-[10.5px] text-[#2E7D32]">({n(x.interested)})</span></> : <span className="text-[#DADADA]">·</span>}
                    </td>;
                  })}
                  <td className="px-2.5 py-1.5 text-right font-bold tabular-nums">{n(tot)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CropsByRound({ data }: { data: RoundAnalytics }) {
  const started = data.rounds.filter((r) => r.status !== "upcoming" && (data.otherCrops[r.ordinal]?.length ?? 0) > 0);
  if (!started.length) return null;
  return (
    <div className={`${CARD} p-4`}>
      <div className="mb-2 text-[13px] font-bold text-[#1A1C1A]">Crops farmers asked for — by round</div>
      <div className="flex flex-col gap-2">
        {started.map((r) => (
          <div key={r.ordinal} className="flex flex-wrap items-center gap-1.5">
            <RoundBadge ord={r.ordinal} small />
            {data.otherCrops[r.ordinal].map((c) => <span key={c.crop} className="rounded-full border border-[#FFCC80] bg-[#FFF8F0] px-2 py-0.5 text-[11px] font-semibold text-[#E65100]">{cropLabel(c.crop)} · {n(c.count)}</span>)}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Response mix per round as stacked bars (share of test farmers) — the at-a-glance round comparison. */
function ResponseMix({ data }: { data: RoundAnalytics }) {
  const started = data.rounds.filter((r) => r.status !== "upcoming");
  const parts = (s: RoundStat): { cat: RoundCat; v: number }[] => [
    { cat: "INTERESTED", v: s.interested }, { cat: "NOT_INTERESTED", v: s.notInterested }, { cat: "OTHER_CROP", v: s.otherCrop },
    { cat: "REACHED", v: s.noResponse }, { cat: "UNREACHABLE", v: s.unreachable }, { cat: "NONE", v: Math.max(0, s.test - s.reached - s.unreachable) },
  ];
  return (
    <div className={`${CARD} p-4`}>
      <div className="mb-1 text-[13px] font-bold text-[#1A1C1A]">Outcome mix by round</div>
      <div className="mb-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#616161]">
        {CATS.map((c) => <span key={c} className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: CAT_COLOR[c] }} />{CAT_LABEL[c]}</span>)}
      </div>
      <div className="flex flex-col gap-2">
        {started.map((r) => {
          const s = data.stats.find((x) => x.ordinal === r.ordinal)!;
          return (
            <div key={r.ordinal} className="flex items-center gap-2.5">
              <span className="flex w-[64px] shrink-0 items-center gap-1"><RoundBadge ord={r.ordinal} small />{r.status === "current" && <span className="text-[10px] text-[#00838F]">now</span>}</span>
              <div className="flex h-[20px] flex-1 gap-[2px] overflow-hidden rounded-[5px]">
                {parts(s).filter((p) => p.v > 0).map((p) => (
                  <div key={p.cat} title={`${CAT_LABEL[p.cat]}: ${n(p.v)} (${p1(pct(p.v, s.test))})`} style={{ width: `${pct(p.v, s.test)}%`, background: CAT_COLOR[p.cat] }} />
                ))}
              </div>
              <span className="w-[110px] shrink-0 text-right text-[11px] text-[#616161]"><b className="text-[#2E7D32]">{p1(pct(s.interested, s.test))}</b> interested</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The "🔁 Rounds" tab body. */
export function RoundsTab({ data }: { data: RoundAnalytics }) {
  const started = data.rounds.filter((r) => r.status !== "upcoming");
  return (
    <div className="flex flex-col gap-4">
      <RoundStrip data={data} />
      {started.length < 2 && (
        <div className="rounded-[10px] border border-[#B2EBF2] bg-[#F0FBFC] px-3 py-2 text-[11.5px] text-[#00695C]">
          This campaign is still in its first round, so every section shows round {started[0]?.ordinal ?? 1} only. When you advance to the next round,
          the comparisons (change columns, round → round flow, pace lines) fill in automatically.
        </div>
      )}
      <CompareTable data={data} />
      <ResponseMix data={data} />
      <PaceChart data={data} />
      <FlowCard data={data} />
      <GeoCompare data={data} />
      <CallersCard data={data} />
      <CropsByRound data={data} />
    </div>
  );
}
