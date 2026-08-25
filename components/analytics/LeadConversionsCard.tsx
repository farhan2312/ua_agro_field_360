"use client";

import { useEffect, useState } from "react";
import { getLeadConversions, type LeadConversions } from "@/app/actions/analytics-segments";

const CARD = "rounded-[14px] border border-black/[0.04] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]";
const n = (x: number) => x.toLocaleString("en-IN");

/** Bar list — one row per bucket, bar width relative to the max. */
function Bars({ rows }: { rows: { label: string; n: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2">
          <span className="w-[92px] shrink-0 truncate text-[11.5px] text-[#616161]" title={r.label}>{r.label}</span>
          <div className="relative h-[18px] flex-1 overflow-hidden rounded-[5px] bg-[#F1F8F1]">
            <div className="h-full rounded-[5px] bg-[#2E7D32]" style={{ width: `${Math.max(4, (r.n / max) * 100)}%` }} />
          </div>
          <span className="w-9 shrink-0 text-right text-[11.5px] font-semibold text-[#1A1C1A]">{n(r.n)}</span>
        </div>
      ))}
    </div>
  );
}

/** Lead → customer conversions, broken down by month and by store (role-scoped on the server). */
export function LeadConversionsCard() {
  const [data, setData] = useState<LeadConversions | null>(null);
  useEffect(() => { getLeadConversions().then(setData).catch(() => setData({ total: 0, byMonth: [], byStore: [] })); }, []);

  return (
    <div className={`${CARD} mt-4 p-5`}>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[14px] font-bold text-[#1A1C1A]">🌱 Lead → customer conversions</span>
        {data && <span className="rounded-full bg-[#E8F5E9] px-2 py-0.5 text-[11px] font-bold text-[#2E7D32]">{n(data.total)} total</span>}
      </div>
      <p className="mb-3 text-[12px] text-[#9E9E9E]">Farmers first registered as leads (no purchase) who have since bought. Counts from when tracking began.</p>

      {data == null ? (
        <div className="py-6 text-center text-[12.5px] text-[#9E9E9E]">Loading…</div>
      ) : data.total === 0 ? (
        <div className="rounded-[10px] bg-[#FAFBFA] px-3 py-6 text-center text-[12.5px] text-[#9E9E9E]">
          No conversions recorded yet. As new sales uploads bring purchases for existing leads, they’ll appear here.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]">By month converted</div>
            <Bars rows={data.byMonth} />
          </div>
          <div>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]">By store (top 40)</div>
            <div className="max-h-[240px] overflow-y-auto pr-1">
              <Bars rows={data.byStore.map((s) => ({ label: s.store, n: s.n }))} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
