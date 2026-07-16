"use client";

import { useEffect, useState, useTransition } from "react";
import { Modal, ModalHeader } from "@/components/interactive";
import { SEGMENT_COLUMNS, segMeta } from "@/lib/campaign-segments";
import { cropLabel } from "@/lib/crops";
import {
  getWorkbench, getWorkbenchCustomers, saveWorkbenchSegment, getCropTrend,
  type Lens, type WbFilters, type WbData, type WbFacets, type WbBar, type WbCustomer, type CropTrendPoint,
} from "@/app/actions/analytics-segments";

const CARD = "rounded-[14px] border border-black/[0.04] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]";
const n = (x: number) => Math.round(x).toLocaleString("en-IN");
const money = (x: number) => (x >= 1e7 ? `₹${(x / 1e7).toFixed(2)} Cr` : x >= 1e5 ? `₹${(x / 1e5).toFixed(1)} L` : `₹${n(x)}`);

export function AnalyticsWorkbench({ initial, facets }: { initial: WbData; facets: WbFacets }) {
  const [filters, setFilters] = useState<WbFilters>({ lens: "sales" });
  const [data, setData] = useState(initial);
  const [loading, start] = useTransition();
  const [cell, setCell] = useState<{ storeId: number | null; storeName: string; seg: string } | null>(null);
  const [rows, setRows] = useState<WbCustomer[] | null>(null);
  const [saving, setSaving] = useState(false);

  const apply = (patch: Partial<WbFilters>) => {
    const f = { ...filters, ...patch };
    setFilters(f);
    start(async () => setData(await getWorkbench(f)));
  };
  const setLens = (lens: Lens) => apply({ lens, crop: undefined, spendTier: undefined, problem: undefined });
  const clearAll = () => apply({ storeId: undefined, zone: undefined, crop: undefined, segment: undefined, spendTier: undefined, problem: undefined });

  const openCell = (storeId: number | null, storeName: string, seg: string) => {
    setCell({ storeId, storeName, seg }); setRows(null);
    getWorkbenchCustomers(filters, storeId, seg).then(setRows);
  };

  const cropOpts = filters.lens === "sales" ? facets.salesCrops : facets.visitCrops;
  const activeFilterCount = [filters.storeId, filters.zone, filters.crop, filters.segment, filters.spendTier, filters.problem].filter((x) => x != null && x !== "").length;
  const k = data.kpis;
  const KPIS = filters.lens === "sales"
    ? [["Farmers", n(k.farmers)], ["HNI", n(k.hni)], ["Potential HNI", n(k.potentialHni)], ["At-Risk", n(k.atRisk)], ["Lapsed", n(k.lapsed)], ["P12M spend", money(k.spend)]]
    : [["Farmers", n(k.farmers)], ["Visits", n(k.visits)], ["HNI", n(k.hni)], ["At-Risk", n(k.atRisk)], ["Lapsed", n(k.lapsed)], ["P12M spend", money(k.spend)]];

  return (
    <div className="animate-[fadeUp_0.4s_ease-out]">
      {/* Lens toggle + save */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-[10px] border border-[#E0E0E0] bg-[#F5F7F5] p-1">
          {(["sales", "visit"] as Lens[]).map((l) => (
            <button key={l} type="button" onClick={() => setLens(l)}
              className="rounded-[8px] px-5 py-2 text-[12.5px] font-bold transition-colors"
              style={{ background: filters.lens === l ? "#fff" : "transparent", color: filters.lens === l ? "#2E7D32" : "#9E9E9E", boxShadow: filters.lens === l ? "0 1px 3px rgba(0,0,0,0.12)" : "none" }}>
              {l === "sales" ? "Sales" : "Visits"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {loading && <span className="text-[12px] text-[#9E9E9E]">Updating…</span>}
          <button type="button" onClick={() => setSaving(true)} disabled={k.farmers === 0}
            className="rounded-[10px] bg-[#2E7D32] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50">＋ Save as cluster</button>
        </div>
      </div>

      {/* Filter bar */}
      <div className={`${CARD} mb-3 flex flex-wrap items-center gap-2 p-3`}>
        <span className="text-[11px] font-bold uppercase tracking-[0.5px] text-[#9E9E9E]">{filters.lens === "sales" ? "Sales filters" : "Visit filters"}:</span>
        <Sel value={filters.storeId != null ? String(filters.storeId) : ""} onChange={(v) => apply({ storeId: v ? Number(v) : undefined })}
          ph="All stores" options={facets.stores.map((s) => [String(s.id), s.name])} />
        <Sel value={filters.zone ?? ""} onChange={(v) => apply({ zone: v || undefined })} ph="All zones" options={facets.zones} />
        <Sel value={filters.crop ?? ""} onChange={(v) => apply({ crop: v || undefined })} ph="All crops"
          options={cropOpts.map((c) => [c.crop, `${cropLabel(c.crop)} (${n(c.count)})`])} />
        <Sel value={filters.segment ?? ""} onChange={(v) => apply({ segment: v || undefined })} ph="All segments"
          options={SEGMENT_COLUMNS.map((s) => [s, segMeta(s).label])} />
        {filters.lens === "sales" ? (
          <Sel value={filters.spendTier != null ? String(filters.spendTier) : ""} onChange={(v) => apply({ spendTier: v ? Number(v) : undefined })}
            ph="Any spend" options={facets.spendTiers.map((t, i) => [String(i), t])} />
        ) : (
          <Sel value={filters.problem ?? ""} onChange={(v) => apply({ problem: v || undefined })} ph="Any problem"
            options={facets.problems.map((p) => [p.problem, `${p.problem} (${n(p.count)})`])} />
        )}
        {activeFilterCount > 0 && <button type="button" onClick={clearAll} className="text-[12px] font-semibold text-[#C62828] hover:underline">Clear ({activeFilterCount})</button>}
      </div>

      {/* KPIs */}
      <div className="mb-3 grid grid-cols-2 gap-[12px] sm:grid-cols-3 lg:grid-cols-6">
        {KPIS.map(([label, val]) => (
          <div key={label} className={`${CARD} p-3.5`}>
            <div className="text-[10.5px] font-bold uppercase tracking-[0.3px] text-[#9E9E9E]">{label}</div>
            <div className="mt-1 text-[19px] font-bold text-[#1A1C1A]">{val}</div>
          </div>
        ))}
      </div>

      {/* One board — trend, charts, and the matrix together */}
      <div className="flex flex-col gap-[14px]">
        {filters.lens === "sales" && <CropTrendCard crops={facets.salesCrops} />}

        <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-2">
          <DonutCard title="Segment share" slices={data.segmentDist} />
          {filters.lens === "sales" ? (
            <HistogramCard title="Spend tiers (P12M) — farmer histogram" bars={data.extra} />
          ) : (
            <BarCard title={data.extraTitle} bars={data.extra} fmt={n} accent="#1565C0" />
          )}
          <BarCard title={filters.lens === "sales" ? "Sales-crop breakdown (farmers)" : "Visit-crop breakdown (farmers)"} bars={data.cropBreakdown.map((b) => ({ ...b, label: cropLabel(b.label) }))} fmt={n} accent="#F9A825" />
          <BarCard title={data.secondaryTitle} bars={data.secondary} fmt={filters.lens === "sales" ? money : n} accent="#6A1B9A" />
        </div>

        <div className={`${CARD} overflow-hidden`}>
          <div className="border-b border-[#F0F0F0] px-4 py-2.5 text-[13px] font-bold text-[#1A1C1A]">Store × Segment</div>
          <div className="overflow-x-auto">
            <div className="min-w-[820px]">
              <div className="grid grid-cols-[1.4fr_repeat(6,1fr)_0.8fr] border-b border-[#F0F0F0] bg-[#FAFAFA] px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.4px] text-[#9E9E9E]">
                <div>Store</div>
                {SEGMENT_COLUMNS.map((s) => <div key={s} className="text-right" style={{ color: segMeta(s).color }}>{segMeta(s).label}</div>)}
                <div className="text-right">Total</div>
              </div>
              {data.matrix.rows.length === 0 ? (
                <div className="px-4 py-10 text-center text-[13px] text-[#9E9E9E]">No farmers match these filters.</div>
              ) : (
                <>
                  <div className="grid grid-cols-[1.4fr_repeat(6,1fr)_0.8fr] border-b border-[#EEE] bg-[#F5FBF5] px-4 py-2.5 text-[12px] font-bold text-[#1A1C1A]">
                    <div>All stores</div>
                    {SEGMENT_COLUMNS.map((s) => <div key={s} className="text-right">{n(data.matrix.totals[s] ?? 0)}</div>)}
                    <div className="text-right">{n(data.matrix.grandTotal)}</div>
                  </div>
                  {data.matrix.rows.map((r) => (
                    <div key={String(r.storeId)} className="grid grid-cols-[1.4fr_repeat(6,1fr)_0.8fr] items-center border-b border-[#F8F8F8] px-4 py-2 text-[12px]">
                      <div className="truncate font-semibold text-[#1A1C1A]" title={r.storeName}>{r.storeName}</div>
                      {SEGMENT_COLUMNS.map((s) => {
                        const c = r.counts[s] ?? 0;
                        return <div key={s} className="text-right">{c > 0 ? (
                          <button type="button" onClick={() => openCell(r.storeId, r.storeName, s)} className="font-semibold hover:underline" style={{ color: segMeta(s).color }}>{n(c)}</button>
                        ) : <span className="text-[#DDD]">·</span>}</div>;
                      })}
                      <div className="text-right font-bold text-[#1A1C1A]">{n(r.total)}</div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
          <div className="px-4 py-2 text-[11px] text-[#9E9E9E]">Click any count to see that store × segment farmer list. Segments are exclusive.</div>
        </div>
      </div>

      {/* Drill modal */}
      <Modal open={!!cell} onClose={() => setCell(null)} className="max-w-[720px]">
        {cell && (
          <>
            <ModalHeader eyebrow={`${cell.storeName} · ${segMeta(cell.seg).label}`} eyebrowColor={segMeta(cell.seg).color}
              title="Farmer list" subtitle="Matches the current filters" onClose={() => setCell(null)} />
            <div className="max-h-[64vh] overflow-y-auto px-5 py-4">
              {rows == null ? <div className="py-8 text-center text-[13px] text-[#9E9E9E]">Loading…</div>
                : rows.length === 0 ? <div className="py-8 text-center text-[13px] text-[#9E9E9E]">No farmers.</div>
                : (
                  <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-[12.5px]">
                    <thead><tr className="border-b border-[#EEE] text-[10px] font-bold uppercase text-[#9E9E9E]"><th className="py-2">Farmer</th><th>Crops</th><th className="text-right">P12M spend</th></tr></thead>
                    <tbody>{rows.map((fr) => (
                      <tr key={fr.id} className="border-b border-[#F5F5F5]">
                        <td className="py-2"><div className="font-semibold text-[#1A1C1A]">{fr.name}</div><div className="text-[11px] text-[#9E9E9E]">{fr.village ?? "—"} · {fr.mobile ?? "—"}</div></td>
                        <td className="py-2"><div className="flex flex-wrap gap-1">
                          {fr.salesCrops.map((c) => <span key={"s" + c} className="rounded-full bg-[#E8F5E9] px-1.5 py-0.5 text-[10px] font-semibold text-[#2E7D32]">{cropLabel(c)}</span>)}
                          {fr.visitCrops.map((c) => <span key={"v" + c} className="rounded-full bg-[#E3F2FD] px-1.5 py-0.5 text-[10px] font-semibold text-[#1565C0]">{cropLabel(c)}</span>)}
                          {fr.salesCrops.length === 0 && fr.visitCrops.length === 0 && <span className="text-[#DDD]">—</span>}
                        </div></td>
                        <td className="text-right font-semibold text-[#1A1C1A]">{fr.spend}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                  {rows.length >= 400 && <div className="mt-2 text-[11px] text-[#9E9E9E]">Showing first 400 by spend.</div>}
                  </div>
                )}
            </div>
          </>
        )}
      </Modal>

      {saving && <SaveModal filters={filters} kpi={k.farmers} onClose={() => setSaving(false)} />}
    </div>
  );
}

function Sel({ value, onChange, ph, options }: { value: string; onChange: (v: string) => void; ph: string; options: (string | [string, string])[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-lg border border-[#E0E0E0] bg-white px-2.5 py-2 text-[12.5px] text-[#424242]">
      <option value="">{ph}</option>
      {options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return <option key={v} value={v}>{l}</option>; })}
    </select>
  );
}

function BarCard({ title, bars, fmt, accent = "#2E7D32" }: { title: string; bars: WbBar[]; fmt: (x: number) => string; accent?: string }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const shown = bars.filter((b) => b.value > 0);
  return (
    <div className={`${CARD} p-4`}>
      <div className="mb-3 text-[13px] font-bold text-[#1A1C1A]">{title}</div>
      {shown.length === 0 ? <div className="py-6 text-center text-[12.5px] text-[#9E9E9E]">No data.</div> : (
        <div className="flex flex-col gap-2">
          {shown.map((b) => (
            <div key={b.label}>
              <div className="flex justify-between text-[11.5px]"><span className="truncate font-medium text-[#424242]" title={b.label}>{b.label}</span><span className="ml-2 shrink-0 text-[#9E9E9E]">{fmt(b.value)}</span></div>
              <div className="mt-0.5 h-2 rounded-full bg-[#F0F0F0]"><div className="h-2 rounded-full" style={{ width: `${(b.value / max) * 100}%`, background: b.color ?? accent }} /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Donut / pie — share of farmers per segment. */
function DonutCard({ title, slices }: { title: string; slices: WbBar[] }) {
  const shown = slices.filter((s) => s.value > 0);
  const total = shown.reduce((a, b) => a + b.value, 0);
  const R = 54, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className={`${CARD} p-4`}>
      <div className="mb-3 text-[13px] font-bold text-[#1A1C1A]">{title}</div>
      {total === 0 ? <div className="py-6 text-center text-[12.5px] text-[#9E9E9E]">No data.</div> : (
        <div className="flex flex-wrap items-center gap-5">
          <div className="relative shrink-0">
            <svg width="150" height="150" viewBox="0 0 150 150" className="-rotate-90">
              <circle cx="75" cy="75" r={R} fill="none" stroke="#F0F0F0" strokeWidth="20" />
              {shown.map((s) => {
                const frac = s.value / total;
                const el = (
                  <circle key={s.label} cx="75" cy="75" r={R} fill="none" stroke={s.color ?? "#2E7D32"} strokeWidth="20"
                    strokeDasharray={`${frac * C} ${C}`} strokeDashoffset={-acc * C}>
                    <title>{`${s.label}: ${n(s.value)} (${((s.value / total) * 100).toFixed(1)}%)`}</title>
                  </circle>
                );
                acc += frac;
                return el;
              })}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-[17px] font-bold text-[#1A1C1A]">{n(total)}</div>
              <div className="text-[9.5px] uppercase text-[#9E9E9E]">farmers</div>
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {shown.map((s) => (
              <div key={s.label} className="flex items-center gap-2 text-[12px]">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color ?? "#2E7D32" }} />
                <span className="truncate font-medium text-[#424242]">{s.label}</span>
                <span className="ml-auto shrink-0 text-[#9E9E9E]">{n(s.value)} · {((s.value / total) * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Vertical histogram — farmers per spend tier. */
function HistogramCard({ title, bars, accent = "#1565C0" }: { title: string; bars: WbBar[]; accent?: string }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className={`${CARD} p-4`}>
      <div className="mb-3 text-[13px] font-bold text-[#1A1C1A]">{title}</div>
      {bars.every((b) => !b.value) ? <div className="py-6 text-center text-[12.5px] text-[#9E9E9E]">No data.</div> : (
        <div className="flex items-end gap-2.5 pt-2">
          {bars.map((b) => (
            <div key={b.label} className="flex min-w-0 flex-1 flex-col items-center" title={`${b.label}: ${n(b.value)} farmers`}>
              <div className="mb-1 text-[10.5px] font-bold text-[#424242]">{b.value ? n(b.value) : ""}</div>
              <div className="w-full rounded-t-[6px]" style={{ height: `${Math.max(b.value > 0 ? 4 : 1, Math.round((b.value / max) * 110))}px`, background: b.color ?? accent }} />
              <div className="mt-1 w-full truncate text-center text-[10px] text-[#9E9E9E]" title={b.label}>{b.label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Monthly purchase trend for one crop, coloured by cropping season (uses the per-line crop tags). */
const SEASON_COLOR: Record<CropTrendPoint["season"], string> = { Kharif: "#2E7D32", Rabi: "#1565C0", Zaid: "#F9A825" };

function CropTrendCard({ crops }: { crops: { crop: string; count: number }[] }) {
  const [crop, setCrop] = useState(crops[0]?.crop ?? "");
  const [points, setPoints] = useState<CropTrendPoint[] | null>(null);
  const [loading, start] = useTransition();

  useEffect(() => {
    if (!crop) { setPoints([]); return; }
    start(async () => setPoints(await getCropTrend(crop)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crop]);

  const pts = points ?? [];
  const max = Math.max(1, ...pts.map((p) => p.revenue));
  const totalRev = pts.reduce((a, p) => a + p.revenue, 0);
  const seasonTotals = pts.reduce((m, p) => { m[p.season] = (m[p.season] ?? 0) + p.revenue; return m; }, {} as Record<string, number>);

  return (
    <div className={`${CARD} p-4`}>
      <div className="mb-1 flex flex-wrap items-center gap-2.5">
        <div className="text-[13px] font-bold text-[#1A1C1A]">Crop purchase trend</div>
        <Sel value={crop} onChange={setCrop} ph="Pick a crop"
          options={crops.map((c) => [c.crop, `${cropLabel(c.crop)} (${n(c.count)})`])} />
        {loading && <span className="text-[11.5px] text-[#9E9E9E]">Loading…</span>}
        <div className="ml-auto flex flex-wrap items-center gap-3 text-[11px] font-medium text-[#616161]">
          {(["Kharif", "Rabi", "Zaid"] as const).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: SEASON_COLOR[s] }} />
              {s}{seasonTotals[s] ? ` · ${money(seasonTotals[s])}` : ""}
            </span>
          ))}
          {totalRev > 0 && <span className="rounded-full bg-[#F5F7F5] px-2.5 py-0.5 font-bold text-[#1A1C1A]">Total {money(totalRev)}</span>}
        </div>
      </div>
      <div className="mb-3 text-[11px] text-[#9E9E9E]">
        Monthly ₹ of {crop ? cropLabel(crop) : "—"}-tagged sale lines · seasons: Kharif Jun–Oct · Rabi Nov–Mar · Zaid Apr–May
      </div>
      {points == null ? (
        <div className="py-10 text-center text-[12.5px] text-[#9E9E9E]">Loading…</div>
      ) : pts.length === 0 ? (
        <div className="py-10 text-center text-[12.5px] text-[#9E9E9E]">No crop-tagged sales recorded for this crop yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <div className="flex items-end gap-[3px]" style={{ minWidth: Math.max(560, pts.length * 22) }}>
            {pts.map((p) => (
              <div key={p.ym} className="group flex min-w-[16px] flex-1 flex-col justify-end"
                title={`${p.label} ${p.year} · ${money(p.revenue)} · ${n(p.lines)} lines · ${p.season}`}>
                <div className="w-full rounded-t-[4px] transition-opacity group-hover:opacity-75"
                  style={{ height: `${Math.max(p.revenue > 0 ? 4 : 1, Math.round((p.revenue / max) * 140))}px`, background: SEASON_COLOR[p.season], opacity: p.revenue > 0 ? 1 : 0.25 }} />
                <div className="mt-1 h-[24px] text-center">
                  <div className="text-[9px] leading-tight text-[#9E9E9E]">{p.label[0]}</div>
                  {(p.label === "Jan" || p.ym === pts[0].ym) && <div className="text-[9px] font-bold leading-tight text-[#616161]">{p.year}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SaveModal({ filters, kpi, onClose }: { filters: WbFilters; kpi: number; onClose: () => void }) {
  const [name, setName] = useState("");
  const [saving, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const save = () => {
    setMsg(null);
    start(async () => {
      const res = await saveWorkbenchSegment(filters, name);
      setMsg(res.ok ? "ok" : res.error ?? "Failed");
    });
  };
  return (
    <Modal open onClose={onClose} className="max-w-[460px]">
      <ModalHeader eyebrow="Cluster" eyebrowColor="#2E7D32" title="Save filtered set as a cluster" subtitle={`~${n(kpi)} farmers · membership stays live`} onClose={onClose} />
      <div className="px-5 py-4">
        {msg === "ok" ? (
          <div className="rounded-[10px] border border-[#A5D6A7] bg-[#E8F5E9] px-3.5 py-3 text-[13px] font-medium text-[#2E7D32]">✓ Saved — find it on the Farmer Clusters page (live, re-resolving membership).</div>
        ) : (
          <>
            <label className="text-[11px] font-semibold uppercase text-[#9E9E9E]">Cluster name</label>
            <input autoFocus className="mt-1 w-full rounded-lg border border-[#E0E0E0] px-3 py-2 text-[13px]" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Amethi wheat HNIs" />
            {msg && <div className="mt-2 text-[12px] text-[#C62828]">{msg}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-[10px] border border-[#E0E0E0] px-4 py-2 text-[13px] font-semibold text-[#616161]">Cancel</button>
              <button type="button" onClick={save} disabled={saving || !name.trim()} className="rounded-[10px] bg-[#2E7D32] px-5 py-2 text-[13px] font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Create cluster"}</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
