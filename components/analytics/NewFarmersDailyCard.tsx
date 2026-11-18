"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getNewFarmerDays, getNewFarmerDay, exportNewFarmerDayXlsx, type NfDay, type NfDayCount, type NfBucket, type NfFarmer } from "@/app/actions/new-farmers-daily";
import { ORIGIN_COLOR, type OriginKey } from "@/lib/farmer-origin";
import { downloadB64 } from "@/lib/download";

const CARD = "rounded-[14px] border border-black/[0.04] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]";
const n = (x: number) => x.toLocaleString("en-IN");
const inr = (x: number) => `₹${Math.round(x).toLocaleString("en-IN")}`;
const dayLabel = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-IN", { timeZone: "UTC", day: "numeric", month: "short" });
const longDay = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "long", year: "numeric" });

const STRIP = [
  { k: "erp" as const, color: ORIGIN_COLOR.ERP_DAILY, label: "ERP sync" },
  { k: "visit" as const, color: ORIGIN_COLOR.VISIT, label: "Field visit" },
  { k: "import" as const, color: ORIGIN_COLOR.IMPORT, label: "Excel upload" },
  { k: "other" as const, color: ORIGIN_COLOR.MIGRATION, label: "Other" },
];
const STATUS_COLOR: Record<string, string> = { "Lead — no purchase yet": "#90A4AE", "First purchase (1 bill)": "#2E7D32", "Repeat buyer (2+ bills)": "#1B5E20" };
const TIER_COLOR: Record<string, string> = { HNI: "#6A1B9A", "Potential HNI": "#AB47BC", Regular: "#26A69A", "No spend": "#B0BEC5" };

type Filter = { dim: "origin" | "status" | "tier" | "loc"; label: string } | null;
type LocDim = "region" | "district" | "store" | "village";
const LOC_LABEL: Record<LocDim, string> = { region: "Region", district: "District", store: "Store", village: "Village" };

function BarList({ rows, color, onPick, active, money = true }: { rows: NfBucket[]; color: (b: NfBucket) => string; onPick?: (b: NfBucket) => void; active?: string | null; money?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (!rows.length) return <div className="py-3 text-[12px] text-[#BDBDBD]">—</div>;
  return (
    <div className="flex flex-col gap-1">
      {rows.map((r) => {
        const on = active === r.label;
        return (
          <button key={r.label} type="button" onClick={() => onPick?.(r)} disabled={!onPick}
            className={`flex items-center gap-2 rounded-[6px] px-1 py-0.5 text-left ${onPick ? "hover:bg-[#F5F7F5]" : ""} ${on ? "bg-[#EEF4FF] ring-1 ring-[#90CAF9]" : ""}`}
            title={`${r.label}: ${n(r.n)} farmers${money ? ` · ${inr(r.value)} base value` : ""}`}>
            <span className="w-[150px] shrink-0 truncate text-[11.5px] text-[#424242]">{r.label}</span>
            <span className="relative h-[16px] flex-1 overflow-hidden rounded-[4px] bg-[#F3F5F3]">
              <span className="block h-full rounded-[4px]" style={{ width: `${Math.max(3, (r.n / max) * 100)}%`, background: color(r) }} />
            </span>
            <span className="w-10 shrink-0 text-right text-[11.5px] font-semibold tabular-nums text-[#1A1C1A]">{n(r.n)}</span>
            {money && <span className="hidden w-[78px] shrink-0 text-right text-[11px] tabular-nums text-[#757575] sm:block">{r.value ? inr(r.value) : "—"}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * New farmers by day: pick a day (the strip shows the last 45 days, coloured by how farmers came in) and see
 * everyone added that day — how they came (ERP sync from a store bill, field visit, Excel upload), their
 * customer status (lead / first purchase / repeat, value tier) and where they are (region → village, store).
 * Click any bar to filter the farmer list. Role-scoped on the server.
 */
export function NewFarmersDailyCard({ canExport = false }: { canExport?: boolean }) {
  const [days, setDays] = useState<NfDayCount[] | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [data, setData] = useState<NfDay | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>(null);
  const [locDim, setLocDim] = useState<LocDim>("region");
  const [q, setQ] = useState("");
  const [exporting, setExporting] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    getNewFarmerDays(45).then((d) => { setDays(d); setDate((cur) => cur ?? d[0]?.date ?? null); }).catch(() => setDays([]));
  }, []);
  useEffect(() => {
    if (!date) return;
    const s = ++seq.current;
    setLoading(true); setFilter(null); setQ("");
    getNewFarmerDay(date).then((d) => { if (s === seq.current) { setData(d); setLoading(false); } }).catch(() => { if (s === seq.current) { setData(null); setLoading(false); } });
  }, [date]);

  const strip = useMemo(() => (days ?? []).slice(0, 45).reverse(), [days]);
  const stripMax = Math.max(1, ...strip.map((d) => d.total));

  const locRows = data ? { region: data.byRegion, district: data.byDistrict, store: data.byStore, village: data.byVillage }[locDim] : [];
  const locOf = (f: NfFarmer) => ({ region: f.region, district: f.district, store: f.store, village: f.village }[locDim]) || "Not set";
  const visible = useMemo(() => {
    if (!data) return [];
    const term = q.trim().toLowerCase();
    return data.farmers.filter((f) => {
      if (filter?.dim === "origin" && f.originLabel !== filter.label) return false;
      if (filter?.dim === "status" && f.status !== filter.label) return false;
      if (filter?.dim === "tier" && f.tier !== filter.label) return false;
      if (filter?.dim === "loc" && locOf(f) !== filter.label) return false;
      if (term && ![f.name, f.mobile, f.village, f.district, f.store, f.code].some((x) => (x ?? "").toLowerCase().includes(term))) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, filter, q, locDim]);
  const pick = (dim: NonNullable<Filter>["dim"]) => (b: NfBucket) => setFilter((f) => (f?.dim === dim && f.label === b.label ? null : { dim, label: b.label }));

  const doExport = async () => {
    if (!date) return;
    setExporting(true);
    try { const r = await exportNewFarmerDayXlsx(date); if (r.ok && r.b64 && r.filename) downloadB64(r.b64, r.filename); else alert(r.error ?? "Export failed."); }
    finally { setExporting(false); }
  };

  return (
    <div className={`${CARD} p-5`}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-bold text-[#1A1C1A]">🆕 New farmers by day</span>
        {data && date && <span className="rounded-full bg-[#E3F2FD] px-2 py-0.5 text-[11px] font-bold text-[#1565C0]">{n(data.total)} added on {dayLabel(date)}</span>}
        <div className="ml-auto flex items-center gap-2">
          <input type="date" value={date ?? ""} onChange={(e) => e.target.value && setDate(e.target.value)}
            className="rounded-[8px] border border-[#E0E0E0] px-2 py-1 text-[12px]" aria-label="Pick a day" />
          {canExport && data && data.total > 0 && (
            <button type="button" onClick={doExport} disabled={exporting} className="rounded-[8px] border border-[#2E7D32] px-2.5 py-1 text-[12px] font-semibold text-[#2E7D32] hover:bg-[#F1F8F1] disabled:opacity-50">
              {exporting ? "Preparing…" : "⬇ Excel"}
            </button>
          )}
        </div>
      </div>
      <p className="mb-3 text-[12px] text-[#9E9E9E]">Everyone added to Field360 on a day (India time), how they came in, their customer status and where they are. The nightly ERP sync runs at about 2 AM, so a day&apos;s ERP farmers come from the previous days&apos; store bills. Click a bar to filter the list.</p>

      {/* Day strip — last 45 days, stacked by how farmers came in */}
      {days == null ? <div className="py-6 text-center text-[12.5px] text-[#9E9E9E]">Loading…</div> : strip.length === 0 ? (
        <div className="rounded-[10px] bg-[#FAFBFA] px-3 py-6 text-center text-[12.5px] text-[#9E9E9E]">No farmers added in the last 45 days.</div>
      ) : (
        <div className="mb-4">
          <div className="overflow-x-auto pb-1">
            <div className="flex min-w-max items-end gap-[3px]" style={{ height: 78 }}>
              {strip.map((d) => {
                const on = d.date === date;
                return (
                  <button key={d.date} type="button" onClick={() => setDate(d.date)} title={`${longDay(d.date)} — ${n(d.total)} added (ERP ${n(d.erp)} · field visit ${n(d.visit)} · Excel ${n(d.import)}${d.other ? ` · other ${n(d.other)}` : ""})`}
                    className={`flex h-full w-[16px] flex-col justify-end rounded-[3px] ${on ? "ring-2 ring-[#1A1C1A] ring-offset-1" : "hover:opacity-80"}`}>
                    {STRIP.map((s) => d[s.k] > 0 && (
                      <span key={s.k} className="block w-full first:rounded-t-[3px]" style={{ height: `${(d[s.k] / stripMax) * 100}%`, background: s.color, borderTop: "1px solid #fff" }} />
                    ))}
                  </button>
                );
              })}
            </div>
            <div className="mt-1 flex min-w-max gap-[3px] text-[8.5px] text-[#9E9E9E]">
              {strip.map((d, i) => <span key={d.date} className="w-[16px] text-center">{i % 5 === 0 || d.date === date ? dayLabel(d.date).split(" ")[0] : ""}</span>)}
            </div>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-[#616161]">
            {STRIP.map((s) => <span key={s.k} className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: s.color }} />{s.label}</span>)}
          </div>
        </div>
      )}

      {date && (loading && !data ? <div className="py-6 text-center text-[12.5px] text-[#9E9E9E]">Loading {longDay(date)}…</div> : data && (
        <div className={loading ? "opacity-50 transition-opacity" : ""}>
          <div className="mb-1 text-[12.5px] font-semibold text-[#1A1C1A]">{longDay(date)}</div>
          {data.total === 0 ? (
            <div className="rounded-[10px] bg-[#FAFBFA] px-3 py-6 text-center text-[12.5px] text-[#9E9E9E]">No farmers were added on this day.</div>
          ) : (
            <>
              <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[["Added", n(data.total), "#1A1C1A"], ["Have bought", n(data.bought), "#2E7D32"], ["Leads (no purchase yet)", n(data.leads), "#546E7A"], ["Their base value", inr(data.value), "#1565C0"], ["Average bill", data.avgBill ? inr(data.avgBill) : "—", "#1A1C1A"]].map(([l, v, c]) => (
                  <div key={l} className="rounded-[10px] border border-[#EEF0EE] bg-[#FAFBFA] px-3 py-2">
                    <div className="text-[10px] font-bold uppercase tracking-[0.3px] text-[#9E9E9E]">{l}</div>
                    <div className="text-[17px] font-bold tabular-nums" style={{ color: c }}>{v}</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <div>
                  <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]">How they came</div>
                  <BarList rows={data.byOrigin} color={(b) => ORIGIN_COLOR[(b as NfBucket & { key: OriginKey }).key] ?? "#9E9E9E"} onPick={pick("origin")} active={filter?.dim === "origin" ? filter.label : null} />
                  {data.runs.length > 0 && <div className="mt-1.5 text-[10.5px] text-[#9E9E9E]">ERP: {data.runs.join(" · ")}</div>}
                </div>
                <div>
                  <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]">Customer status</div>
                  <BarList rows={data.byStatus} color={(b) => STATUS_COLOR[b.label] ?? "#9E9E9E"} onPick={pick("status")} active={filter?.dim === "status" ? filter.label : null} />
                  <div className="mb-1.5 mt-3 text-[11px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]">Value tier (base spend so far)</div>
                  <BarList rows={data.byTier} color={(b) => TIER_COLOR[b.label] ?? "#9E9E9E"} onPick={pick("tier")} active={filter?.dim === "tier" ? filter.label : null} />
                </div>
                <div>
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]">Where they are</span>
                    <div className="ml-auto inline-flex rounded-[8px] border border-[#E0E0E0] bg-[#F5F7F5] p-0.5">
                      {(Object.keys(LOC_LABEL) as LocDim[]).map((k) => (
                        <button key={k} type="button" onClick={() => { setLocDim(k); setFilter((f) => (f?.dim === "loc" ? null : f)); }}
                          className={`rounded-[6px] px-2 py-0.5 text-[11px] font-semibold ${locDim === k ? "bg-white text-[#1A1C1A] shadow-sm" : "text-[#9E9E9E]"}`}>{LOC_LABEL[k]}</button>
                      ))}
                    </div>
                  </div>
                  <div className="max-h-[260px] overflow-y-auto pr-1">
                    <BarList rows={locRows} color={() => "#00897B"} onPick={pick("loc")} active={filter?.dim === "loc" ? filter.label : null} />
                  </div>
                  {(locDim === "store" || locDim === "village") && locRows.length >= 40 && <div className="mt-1 text-[10.5px] text-[#9E9E9E]">Top 40 shown.</div>}
                </div>
                <div>
                  <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]">What they bought (base value)</div>
                  <BarList rows={data.byCategory} color={() => "#F9A825"} />
                  {data.byCrop.length > 0 && <>
                    <div className="mb-1.5 mt-3 text-[11px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]">Crops</div>
                    <BarList rows={data.byCrop} color={() => "#8D6E63"} />
                  </>}
                </div>
              </div>

              {/* Farmer list */}
              <div className="mt-5">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] font-bold text-[#1A1C1A]">Farmers</span>
                  <span className="text-[11.5px] text-[#9E9E9E]">{visible.length === data.farmers.length ? n(data.farmers.length) : `${n(visible.length)} of ${n(data.farmers.length)}`}</span>
                  {filter && (
                    <button type="button" onClick={() => setFilter(null)} className="rounded-full bg-[#EEF4FF] px-2.5 py-0.5 text-[11px] font-semibold text-[#1565C0]">{filter.label} ×</button>
                  )}
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, mobile, village, store…"
                    className="ml-auto w-full rounded-[8px] border border-[#E0E0E0] px-2.5 py-1 text-[12px] sm:w-[260px]" />
                </div>
                <div className="max-h-[440px] overflow-auto rounded-[10px] border border-[#EEE]">
                  <table className="w-full min-w-[980px] text-left text-[12px]">
                    <thead className="sticky top-0 z-[1] bg-[#F7F8F7] text-[10.5px] uppercase tracking-[0.3px] text-[#757575]">
                      <tr>
                        <th className="px-3 py-2">Farmer</th><th className="px-3 py-2">Village · District</th><th className="px-3 py-2">Region</th><th className="px-3 py-2">Store</th>
                        <th className="px-3 py-2">How they came</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Bills</th><th className="px-3 py-2 text-right">Base value</th>
                        <th className="px-3 py-2">First purchase</th><th className="px-3 py-2">Bought</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.slice(0, 1000).map((f) => (
                        <tr key={f.id} className="border-t border-[#F3F3F3] align-top">
                          <td className="px-3 py-1.5"><a href={`/farmers/${f.id}`} className="font-semibold text-[#1A1C1A] hover:underline">{f.name}</a><div className="text-[10.5px] text-[#9E9E9E]">{f.mobile ?? "—"}</div></td>
                          <td className="px-3 py-1.5 text-[#424242]">{f.village ?? "—"}<div className="text-[10.5px] text-[#9E9E9E]">{f.district ?? "—"}</div></td>
                          <td className="px-3 py-1.5 text-[#424242]">{f.region ?? "—"}</td>
                          <td className="px-3 py-1.5 text-[#424242]">{f.store ?? "—"}</td>
                          <td className="px-3 py-1.5" title={[f.via, f.addedBy && `by ${f.addedBy}`].filter(Boolean).join(" · ")}>
                            <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: ORIGIN_COLOR[f.origin] }} />{f.originLabel.split(" — ")[0]}</span>
                            {f.addedBy && f.origin !== "ERP_DAILY" && <div className="text-[10.5px] text-[#9E9E9E]">by {f.addedBy}</div>}
                          </td>
                          <td className="px-3 py-1.5"><span style={{ color: STATUS_COLOR[f.status] ?? "#424242" }} className="font-semibold">{f.status.split(" (")[0]}</span><div className="text-[10.5px] text-[#9E9E9E]">{f.tier}</div></td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{f.bills || "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{f.value ? inr(f.value) : "—"}</td>
                          <td className="px-3 py-1.5 tabular-nums text-[#424242]">{f.firstPurchase ? dayLabel(f.firstPurchase) : "—"}</td>
                          <td className="max-w-[260px] px-3 py-1.5 text-[11px] text-[#616161]"><div className="truncate" title={f.topItems}>{f.topItems || "—"}</div>{f.crops && <div className="truncate text-[10.5px] text-[#9E9E9E]">{f.crops}</div>}</td>
                        </tr>
                      ))}
                      {visible.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-[#9E9E9E]">No farmers match.</td></tr>}
                    </tbody>
                  </table>
                </div>
                {visible.length > 1000 && <div className="mt-1 text-[11px] text-[#9E9E9E]">Showing the first 1,000 — use the filters or search to narrow it.</div>}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
