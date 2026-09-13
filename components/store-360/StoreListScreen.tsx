"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { StoreListItem } from "@/app/actions/store-360";

const CARD = "rounded-[14px] border border-black/[0.04] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]";
const n = (x: number) => x.toLocaleString("en-IN");
const inr = (x: number) => (x >= 1e7 ? `₹${(x / 1e7).toFixed(2)} Cr` : x >= 1e5 ? `₹${(x / 1e5).toFixed(1)} L` : `₹${n(Math.round(x))}`);
const rel = (iso: string | null) => {
  if (!iso) return "no visits";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 30 ? `${d}d ago` : d < 365 ? `${Math.floor(d / 30)}mo ago` : `${Math.floor(d / 365)}y ago`;
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[15px] font-bold leading-none tabular-nums" style={{ color: tone ?? "#1A1C1A" }}>{value}</div>
      <div className="mt-0.5 text-[9.5px] font-semibold uppercase tracking-[0.3px] text-[#9E9E9E]">{label}</div>
    </div>
  );
}

export function StoreListScreen({ stores }: { stores: StoreListItem[] }) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return stores
      .filter((s) => !t || `${s.name} ${s.code} ${s.zone ?? ""} ${s.regionalManager ?? ""}`.toLowerCase().includes(t))
      .sort((a, b) => b.ltv - a.ltv || a.name.localeCompare(b.name));
  }, [stores, q]);

  const totals = useMemo(() => ({
    stores: stores.length,
    farmers: stores.reduce((s, x) => s + x.farmers, 0),
    ltv: stores.reduce((s, x) => s + x.ltv, 0),
    overdue: stores.reduce((s, x) => s + x.overdueActions, 0),
  }), [stores]);

  return (
    <div className="animate-fadeUp">
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className={`${CARD} px-4 py-3`}><Stat label="Stores" value={n(totals.stores)} /></div>
        <div className={`${CARD} px-4 py-3`}><Stat label="Farmers" value={n(totals.farmers)} tone="#2E7D32" /></div>
        <div className={`${CARD} px-4 py-3`}><Stat label="Sales LTV (base)" value={inr(totals.ltv)} tone="#1565C0" /></div>
        <div className={`${CARD} px-4 py-3`}><Stat label="Overdue follow-ups" value={n(totals.overdue)} tone={totals.overdue > 0 ? "#C62828" : "#1A1C1A"} /></div>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search store / code / region / RM…"
          className="w-full max-w-[360px] rounded-[10px] border border-[#E0E0E0] bg-white px-3.5 py-2 text-[13px] outline-none focus:border-[#2E7D32]" />
        <span className="text-[12px] text-[#9E9E9E]">{rows.length} of {stores.length} stores</span>
      </div>

      {rows.length === 0 ? (
        <div className={`${CARD} py-16 text-center text-[13px] text-[#9E9E9E]`}>No stores match.</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((s) => (
            <Link key={s.id} href={`/stores/${s.id}`} className={`${CARD} block p-4 transition-colors hover:border-[#2E7D32]`}>
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-bold text-[#1A1C1A]">{s.name}</div>
                  <div className="mt-0.5 text-[11px] text-[#9E9E9E]">{s.code}{s.zone ? ` · ${s.zone}` : ""}</div>
                  {s.regionalManager && <div className="mt-0.5 text-[10.5px] text-[#BDBDBD]">RM: {s.regionalManager}</div>}
                </div>
                {s.overdueActions > 0 && <span className="shrink-0 rounded-full bg-[#FDECEA] px-2 py-0.5 text-[10px] font-bold text-[#C62828]">{n(s.overdueActions)} overdue</span>}
              </div>
              <div className="grid grid-cols-3 gap-y-3">
                <Stat label="Farmers" value={n(s.farmers)} tone="#2E7D32" />
                <Stat label="Officers" value={n(s.officers)} />
                <Stat label="Sales LTV" value={inr(s.ltv)} tone="#1565C0" />
                <Stat label="Campaigns" value={n(s.activeCampaigns)} tone="#6A1B9A" />
                <Stat label="Open tasks" value={n(s.openActions)} tone={s.openActions > 0 ? "#E65100" : "#1A1C1A"} />
                <Stat label="Last visit" value={rel(s.lastVisit)} />
              </div>
              <div className="mt-3 text-[11px] font-semibold text-[#2E7D32]">Open store 360 →</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
