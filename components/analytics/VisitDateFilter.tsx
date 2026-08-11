"use client";

import { useMemo } from "react";

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Visit date filter: quick buckets + a two-handle range slider across the visit timeline. */
export function VisitDateFilter({ minDate, from, to, onChange }: {
  minDate: string | null;
  from?: string; to?: string;
  onChange: (from?: string, to?: string) => void;
}) {
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const min = useMemo(() => {
    const d = minDate ? new Date(`${minDate}T00:00:00`) : new Date(today.getTime() - 365 * DAY);
    d.setHours(0, 0, 0, 0); return d;
  }, [minDate, today]);

  const total = Math.max(1, Math.round((today.getTime() - min.getTime()) / DAY));
  const clamp = (n: number) => Math.min(total, Math.max(0, n));
  const offOf = (s?: string, fallback = 0) => (s ? clamp(Math.round((new Date(`${s}T00:00:00`).getTime() - min.getTime()) / DAY)) : fallback);
  const fromOff = offOf(from, 0);
  const toOff = offOf(to, total);
  const offToIso = (o: number) => iso(new Date(min.getTime() + clamp(o) * DAY));

  const setFrom = (o: number) => { const nf = Math.min(o, toOff); onChange(offToIso(nf), offToIso(toOff)); };
  const setTo = (o: number) => { const nt = Math.max(o, fromOff); onChange(offToIso(fromOff), offToIso(nt)); };

  const bucket = (kind: number | "month" | "all") => {
    if (kind === "all") return onChange(undefined, undefined);
    if (kind === "month") return onChange(iso(new Date(today.getFullYear(), today.getMonth(), 1)), iso(today));
    return onChange(iso(new Date(today.getTime() - kind * DAY)), iso(today));
  };

  const active = from != null || to != null;
  const leftPct = (fromOff / total) * 100, rightPct = (toOff / total) * 100;
  const BUCKETS: [string, number][] = [["Last 7 days", 7], ["Last 30 days", 30], ["Last 90 days", 90]];

  return (
    <div className="mb-3 rounded-[12px] border border-black/[0.04] bg-white p-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <style>{`
        .vdf-range{-webkit-appearance:none;appearance:none;background:transparent;pointer-events:none;}
        .vdf-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;pointer-events:auto;height:16px;width:16px;border-radius:50%;background:#2E7D32;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3);cursor:pointer;}
        .vdf-range::-moz-range-thumb{pointer-events:auto;height:16px;width:16px;border-radius:50%;background:#2E7D32;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3);cursor:pointer;}
        .vdf-range:focus{outline:none;}
      `}</style>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.5px] text-[#9E9E9E]">Visit dates:</span>
        {BUCKETS.map(([label, d]) => (
          <button key={label} type="button" onClick={() => bucket(d)}
            className="rounded-full border border-[#E0E0E0] px-3 py-1 text-[11.5px] font-semibold text-[#616161] hover:border-[#2E7D32] hover:text-[#2E7D32]">{label}</button>
        ))}
        <button type="button" onClick={() => bucket("month")}
          className="rounded-full border border-[#E0E0E0] px-3 py-1 text-[11.5px] font-semibold text-[#616161] hover:border-[#2E7D32] hover:text-[#2E7D32]">This month</button>
        <button type="button" onClick={() => bucket("all")}
          className="rounded-full border px-3 py-1 text-[11.5px] font-semibold"
          style={{ borderColor: active ? "#E0E0E0" : "#2E7D32", color: active ? "#616161" : "#2E7D32", background: active ? "#fff" : "#E8F5E9" }}>All time</button>
        <span className="ml-auto text-[12px] font-semibold text-[#1A1C1A]">
          {fmt(new Date(min.getTime() + fromOff * DAY))} <span className="text-[#9E9E9E]">→</span> {fmt(new Date(min.getTime() + toOff * DAY))}
        </span>
      </div>

      {/* px-2 insets both ends by half a thumb so the 0%/100% handles are never clipped or unreachable.
          Track + fill are one nested element (single bar); the two inputs sit over the same inset span. */}
      <div className="relative mx-1 h-6 px-2">
        <div className="absolute inset-x-2 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[#EAEAEA]">
          <div className="absolute inset-y-0 rounded-full bg-[#2E7D32]" style={{ left: `${leftPct}%`, right: `${100 - rightPct}%` }} />
        </div>
        <input type="range" min={0} max={total} value={fromOff} onChange={(e) => setFrom(Number(e.target.value))}
          aria-label="From date" className="vdf-range absolute inset-x-2 top-0 h-6" style={{ zIndex: fromOff > total - 8 ? 5 : 3 }} />
        <input type="range" min={0} max={total} value={toOff} onChange={(e) => setTo(Number(e.target.value))}
          aria-label="To date" className="vdf-range absolute inset-x-2 top-0 h-6" style={{ zIndex: 4 }} />
      </div>
    </div>
  );
}
