"use client";

import { useEffect, useState, useTransition } from "react";
import { Modal, ModalHeader } from "@/components/interactive";
import { SEGMENT_COLUMNS, segMeta } from "@/lib/campaign-segments";
import { cropLabel } from "@/lib/crops";
import type { ClusterCriteria } from "@/lib/cluster-rules";
import type { CropOption } from "./CampaignsScreen";
import {
  listClustersWithCounts, deleteCluster, previewClusterCount, type ClusterVM,
} from "@/app/actions/campaigns";
import { createClusterFromCriteria } from "@/app/actions/cluster-builder";
import { getClusterFarmers } from "@/app/actions/clusters";
import type { ClusterMembersResult } from "@/components/clusters/types";

const CARD = "rounded-[14px] border border-black/[0.04] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]";
const n = (x: number) => x.toLocaleString("en-IN");
const SPEND_PRESETS: { label: string; min?: number; max?: number }[] = [
  { label: "HNI ₹12K+", min: 12000 },
  { label: "Potential ₹10–12K", min: 10000, max: 12000 },
  { label: "₹5–10K", min: 5000, max: 10000 },
  { label: "< ₹2.5K", max: 2500 },
];
const ORIGIN_LABEL: Record<string, string> = { map: "Map", segment: "Segments", analytics: "Analytics" };

export function ClustersTab({ initial, zones, crops }: { initial: ClusterVM[]; zones: string[]; crops: CropOption[] }) {
  const [list, setList] = useState(initial);
  const [building, setBuilding] = useState(false);
  const [viewing, setViewing] = useState<ClusterVM | null>(null);
  const [pending, start] = useTransition();

  const refresh = () => start(async () => setList(await listClustersWithCounts()));
  const remove = (id: number) =>
    start(async () => { await deleteCluster(id); setList((l) => l.filter((c) => c.id !== id)); });

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[13px] text-[#757575]">
          Clusters are dynamic — membership re-resolves live as farmers are added or updated. Build one here, or save from the Map / Segments / Analytics.
        </div>
        <button type="button" onClick={() => setBuilding(true)} className="rounded-[10px] bg-[#2E7D32] px-4 py-2 text-[13px] font-semibold text-white">+ New cluster</button>
      </div>

      <div className={`${CARD} overflow-hidden`}>
        {list.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-[#9E9E9E]">No clusters yet — build one or save from a map/segment/analytics view.</div>
        ) : list.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-3 border-b border-[#F5F5F5] px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[13.5px] font-bold text-[#1A1C1A]">{c.name}</span>
                <span className="rounded-full bg-[#F5F7F5] px-2 py-0.5 text-[10px] font-semibold text-[#616161]">{ORIGIN_LABEL[c.origin] ?? c.origin}</span>
                {c.mode === "dynamic" && <span className="rounded-full bg-[#E8F5E9] px-2 py-0.5 text-[10px] font-semibold text-[#2E7D32]">● live</span>}
              </div>
              <div className="mt-0.5 truncate text-[11.5px] text-[#9E9E9E]" title={c.description}>{c.description}</div>
            </div>
            <div className="text-[13px] font-bold text-[#2E7D32]">{n(c.count)}</div>
            <div className="text-[11px] text-[#9E9E9E]">farmers</div>
            <button type="button" onClick={() => setViewing(c)} className="rounded-[8px] bg-[#F5F7F5] px-3 py-1.5 text-[12px] font-semibold text-[#2E7D32] hover:bg-[#E8F5E9]">View</button>
            <button type="button" onClick={() => remove(c.id)} disabled={pending} className="rounded-[8px] bg-[#FDECEA] px-3 py-1.5 text-[12px] font-semibold text-[#C62828] hover:bg-[#F9DCD8] disabled:opacity-50">Delete</button>
          </div>
        ))}
      </div>

      {building && <RuleBuilder zones={zones} crops={crops} onClose={() => setBuilding(false)} onCreated={() => { setBuilding(false); refresh(); }} />}
      {viewing && <MembersModal cluster={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

/* ── Rule builder ── */
function RuleBuilder({ zones, crops: cropOpts, onClose, onCreated }: { zones: string[]; crops: CropOption[]; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [segs, setSegs] = useState<string[]>([]);
  const [crops, setCrops] = useState<string[]>([]);
  const [zone, setZone] = useState("");
  const [spendIdx, setSpendIdx] = useState(-1);
  const [q, setQ] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [saving, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const criteria = (): ClusterCriteria => ({
    campaignSegments: segs.length ? segs : undefined,
    cropTags: crops.length ? crops : undefined,
    zone: zone || undefined,
    ...(spendIdx >= 0 ? { spendMin: SPEND_PRESETS[spendIdx].min, spendMax: SPEND_PRESETS[spendIdx].max } : {}),
    q: q.trim() || undefined,
  });
  const hasAny = segs.length || crops.length || zone || spendIdx >= 0 || q.trim();

  // Debounced live count preview.
  useEffect(() => {
    if (!hasAny) { setCount(null); return; }
    setCounting(true);
    const t = setTimeout(async () => { setCount(await previewClusterCount(criteria())); setCounting(false); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segs, crops, zone, spendIdx, q]);

  const toggle = (arr: string[], set: (a: string[]) => void, v: string) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const save = () => {
    setErr(null);
    start(async () => {
      const res = await createClusterFromCriteria({ name, criteria: criteria(), origin: "segment", mode: "dynamic" });
      if (res.ok) onCreated();
      else setErr(res.error ?? "Failed");
    });
  };

  return (
    <Modal open onClose={onClose} className="max-w-[560px]">
      <ModalHeader eyebrow="Step 1 · Cluster" eyebrowColor="#2E7D32" title="Build a cluster" subtitle="Pick filters — membership stays live" onClose={onClose} />
      <div className="max-h-[68vh] overflow-y-auto px-5 py-4">
        <label className="text-[11px] font-semibold uppercase text-[#9E9E9E]">Name</label>
        <input className="mt-1 mb-3 w-full rounded-lg border border-[#E0E0E0] px-3 py-2 text-[13px]" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Amethi At-Risk HNI" />

        <div className="mb-1.5 text-[11px] font-semibold uppercase text-[#9E9E9E]">Segments (any)</div>
        <div className="mb-3 flex flex-wrap gap-1.5">{SEGMENT_COLUMNS.map((s) => { const on = segs.includes(s); const m = segMeta(s); return (
          <button key={s} type="button" onClick={() => toggle(segs, setSegs, s)} className="rounded-full border-[1.5px] px-3 py-1 text-[12px] font-semibold" style={{ background: on ? m.bg : "#fff", color: on ? m.color : "#616161", borderColor: on ? m.color : "#E0E0E0" }}>{m.label}</button>
        ); })}</div>

        <div className="mb-1.5 text-[11px] font-semibold uppercase text-[#9E9E9E]">Crop (any of)</div>
        <select value="" onChange={(e) => { if (e.target.value) toggle(crops, setCrops, e.target.value); }}
          className="mb-2 w-full rounded-lg border border-[#E0E0E0] bg-white px-3 py-2 text-[13px]">
          <option value="">+ Add a crop…</option>
          {cropOpts.filter((c) => !crops.includes(c.crop)).map((c) => <option key={c.crop} value={c.crop}>{cropLabel(c.crop)} ({c.count.toLocaleString("en-IN")})</option>)}
        </select>
        <div className="mb-3 flex flex-wrap gap-1.5">{crops.map((c) => (
          <button key={c} type="button" onClick={() => toggle(crops, setCrops, c)} className="rounded-full border-[1.5px] border-[#2E7D32] bg-[#E8F5E9] px-3 py-1 text-[12px] font-semibold text-[#2E7D32]">{cropLabel(c)} ✕</button>
        ))}</div>

        <div className="mb-1.5 text-[11px] font-semibold uppercase text-[#9E9E9E]">Spend tier (optional)</div>
        <div className="mb-3 flex flex-wrap gap-1.5">{SPEND_PRESETS.map((p, i) => { const on = spendIdx === i; return (
          <button key={p.label} type="button" onClick={() => setSpendIdx(on ? -1 : i)} className="rounded-full border-[1.5px] px-3 py-1 text-[12px] font-semibold" style={{ background: on ? "#E3F2FD" : "#fff", color: on ? "#1565C0" : "#616161", borderColor: on ? "#1565C0" : "#E0E0E0" }}>{p.label}</button>
        ); })}</div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-semibold uppercase text-[#9E9E9E]">Region</label>
            <select className="mt-1 w-full rounded-lg border border-[#E0E0E0] bg-white px-2.5 py-2 text-[13px]" value={zone} onChange={(e) => setZone(e.target.value)}>
              <option value="">Any region</option>
              {zones.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold uppercase text-[#9E9E9E]">Search</label>
            <input className="mt-1 w-full rounded-lg border border-[#E0E0E0] px-2.5 py-2 text-[13px]" value={q} onChange={(e) => setQ(e.target.value)} placeholder="name / village" />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-[10px] bg-[#F5F7F5] px-4 py-3">
          <div className="text-[12px] text-[#616161]">Matches</div>
          <div className="text-[18px] font-bold text-[#2E7D32]">{!hasAny ? "—" : counting ? "…" : n(count ?? 0)}</div>
        </div>
        {err && <div className="mt-2 text-[12px] text-[#C62828]">{err}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-[10px] border border-[#E0E0E0] px-4 py-2 text-[13px] font-semibold text-[#616161]">Cancel</button>
          <button type="button" onClick={save} disabled={saving || !name.trim() || !hasAny || !count} className="rounded-[10px] bg-[#2E7D32] px-5 py-2 text-[13px] font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Create cluster"}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ── Members viewer ── */
function MembersModal({ cluster, onClose }: { cluster: ClusterVM; onClose: () => void }) {
  const [data, setData] = useState<ClusterMembersResult | null>(null);
  useEffect(() => { getClusterFarmers(cluster.id, 1).then(setData); }, [cluster.id]);
  return (
    <Modal open onClose={onClose} className="max-w-[720px]">
      <ModalHeader eyebrow={cluster.description} eyebrowColor="#2E7D32" title={cluster.name} subtitle={`${n(cluster.count)} farmers · live`} onClose={onClose} />
      <div className="max-h-[64vh] overflow-y-auto px-5 py-4">
        {!data ? <div className="py-8 text-center text-[13px] text-[#9E9E9E]">Loading…</div>
          : data.rows.length === 0 ? <div className="py-8 text-center text-[13px] text-[#9E9E9E]">No members.</div>
          : (
            <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-[12.5px]">
              <thead><tr className="border-b border-[#EEE] text-[10px] font-bold uppercase text-[#9E9E9E]"><th className="py-2">Farmer</th><th>Village</th><th>Crop</th><th>Segment</th><th className="text-right">LTV</th></tr></thead>
              <tbody>{data.rows.map((f) => (
                <tr key={f.id} className="border-b border-[#F5F5F5]">
                  <td className="py-2 font-semibold text-[#1A1C1A]">{f.name}</td>
                  <td className="text-[#616161]">{f.village}</td>
                  <td className="text-[#616161]">{f.crop}</td>
                  <td className="text-[#616161]">{f.segment}</td>
                  <td className="text-right font-semibold text-[#1A1C1A]">{f.ltv}</td>
                </tr>
              ))}</tbody>
            </table>
            {data.total > data.rows.length && <div className="mt-2 text-[11px] text-[#9E9E9E]">Showing first {data.rows.length} of {n(data.total)}.</div>}
            </div>
          )}
      </div>
    </Modal>
  );
}
