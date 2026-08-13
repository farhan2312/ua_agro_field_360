"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Modal, ModalHeader } from "@/components/interactive";
import { getPhaseBoard, getPhaseOutreach, setMemberStatusOverride, type PhaseOutreach, type PhaseOutreachMember } from "@/app/actions/campaign-phases";
import { channelLabel } from "@/lib/campaign-phases";

const CHIP = "rounded-full px-2 py-0.5 text-[10.5px] font-bold";

/** Current-phase, cohort-routed contact list for a store. Officers see their store; RMs/managers pick. */
export function PhaseOutreachPanel({ campaignId, campaignName, onClose }: { campaignId: number; campaignName: string; onClose: () => void }) {
  const [stores, setStores] = useState<{ storeId: number; storeName: string; phaseName: string; currentOrdinal: number }[]>([]);
  const [storeId, setStoreId] = useState<number | null>(null);
  const [data, setData] = useState<PhaseOutreach | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPhaseBoard(campaignId).then((b) => {
      const rows = (b?.rows ?? []).map((r) => ({ storeId: r.storeId, storeName: r.storeName, phaseName: r.phaseName, currentOrdinal: r.currentOrdinal }));
      setStores(rows);
      setStoreId(rows[0]?.storeId ?? null);
      setLoading(false);
    });
  }, [campaignId]);

  useEffect(() => {
    if (storeId == null) { setData(null); return; }
    setData(null);
    getPhaseOutreach(campaignId, storeId).then(setData);
  }, [campaignId, storeId]);

  const reload = () => { if (storeId != null) getPhaseOutreach(campaignId, storeId).then(setData); };

  return (
    <Modal open onClose={onClose} className="max-w-[1040px]">
      <ModalHeader eyebrow="Campaign · phase outreach" eyebrowColor="#1565C0" title={campaignName}
        subtitle="Who to contact right now — routed by the store's current phase" onClose={onClose} />
      <div className="px-5 py-4">
        {loading ? <div className="py-10 text-center text-[13px] text-[#9E9E9E]">Loading…</div>
          : stores.length === 0 ? <div className="py-10 text-center text-[13px] text-[#9E9E9E]">No phased stores in your scope, or phases aren&apos;t set up yet.</div>
          : (
            <>
              {stores.length > 1 && (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]">Store</span>
                  <select value={storeId ?? ""} onChange={(e) => setStoreId(Number(e.target.value))}
                    className="rounded-[10px] border border-[#E0E0E0] bg-white px-3 py-1.5 text-[12.5px] outline-none focus:border-[#1565C0]">
                    {stores.map((s) => <option key={s.storeId} value={s.storeId}>{s.storeName} — {s.currentOrdinal}. {s.phaseName}</option>)}
                  </select>
                </div>
              )}
              {data == null ? <div className="py-10 text-center text-[13px] text-[#9E9E9E]">Loading…</div> : <PhaseList data={data} onChanged={reload} />}
            </>
          )}
      </div>
    </Modal>
  );
}

function PhaseList({ data, onChanged }: { data: PhaseOutreach; onChanged: () => void }) {
  // Group members by cohort for a clean "who + why" view.
  const groups = useMemo(() => {
    const m = new Map<string, PhaseOutreachMember[]>();
    for (const x of data.members) { const a = m.get(x.cohortLabel) ?? []; a.push(x); m.set(x.cohortLabel, a); }
    return [...m.entries()];
  }, [data]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-[#E8F5E9] px-2.5 py-1 text-[11.5px] font-bold text-[#2E7D32]">Phase {data.ordinal}: {data.phaseName}</span>
        <span className="text-[12px] text-[#757575]">{data.members.length} to contact at {data.storeName}</span>
        {data.coupons.length > 0 && (
          <span className="ml-auto flex flex-wrap gap-1.5">
            {data.coupons.map((c) => <span key={c.code} className="rounded-md bg-[#FFF3E0] px-2 py-0.5 text-[11px] font-semibold text-[#E65100]" title={c.minSpend ? `min ₹${c.minSpend}` : undefined}>{c.label}: <b>{c.code}</b></span>)}
          </span>
        )}
      </div>

      {data.members.length === 0 ? (
        <div className="rounded-[12px] border border-dashed border-[#C8E6C9] bg-[#F1F8F1] px-5 py-10 text-center text-[13px] text-[#66857A]">
          Nobody to contact in this phase — everyone here has already converted, or the cohorts are empty. Recompute sales or advance the phase.
        </div>
      ) : groups.map(([label, rows]) => (
        <div key={label} className="mb-4">
          <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]">{label} · {rows.length}</div>
          <div className="flex flex-col gap-2">
            {rows.map((m) => <OutreachRow key={m.memberId} m={m} onChanged={onChanged} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function OutreachRow({ m, onChanged }: { m: PhaseOutreachMember; onChanged: () => void }) {
  const [, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const toggle = (patch: { booked?: boolean; boughtFertiliser?: boolean; boughtCombo?: boolean }) => {
    setBusy(true);
    start(async () => { await setMemberStatusOverride(m.memberId, patch); setBusy(false); onChanged(); });
  };
  const digits = (m.mobile ?? "").replace(/\D/g, "").slice(-10);
  const wa = digits ? `https://wa.me/91${digits}` : null;
  const tel = digits ? `tel:${digits}` : null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-[#EEE] bg-white px-3 py-2.5">
      <div className="min-w-[150px] flex-1">
        <div className="text-[13px] font-semibold text-[#1A1C1A]">{m.name}
          <span className={`${CHIP} ml-2`} style={{ background: m.valueBand === "HNI" ? "#F3E5F5" : "#E0F7FA", color: m.valueBand === "HNI" ? "#6A1B9A" : "#00838F" }}>{m.valueBand === "HNI" ? "HNI" : "Others"}</span>
        </div>
        <div className="text-[11px] text-[#9E9E9E]">{m.village || ""}{m.mobile ? ` · ${m.mobile}` : ""}</div>
      </div>

      {/* Recommended channel + coupon */}
      <div className="text-[11px]">
        {m.recChannel ? <span className={`${CHIP} bg-[#E3F2FD] text-[#1565C0]`}>→ {channelLabel(m.recChannel)}</span> : <span className="text-[#BDBDBD]">no channel set</span>}
        {m.recCommPlan && <span className="ml-1.5 text-[#757575]">{m.recCommPlan}</span>}
      </div>

      {/* Status toggles (officer override) */}
      <div className="flex items-center gap-1">
        {([["booked", "Booked", m.booked], ["boughtFertiliser", "Fert", m.boughtFertiliser], ["boughtCombo", "Combo", m.boughtCombo]] as const).map(([k, lbl, on]) => (
          <button key={k} type="button" disabled={busy} onClick={() => toggle({ [k]: !on } as { booked?: boolean; boughtFertiliser?: boolean; boughtCombo?: boolean })}
            className={`${CHIP} border disabled:opacity-50`}
            style={{ background: on ? "#E8F5E9" : "#fff", color: on ? "#2E7D32" : "#9E9E9E", borderColor: on ? "#A5D6A7" : "#E0E0E0" }}
            title={`Toggle ${lbl}`}>
            {on ? "✓ " : ""}{lbl}
          </button>
        ))}
      </div>

      {/* Quick contact */}
      <div className="flex items-center gap-1.5">
        {tel && <a href={tel} className="rounded-md bg-[#E8F5E9] px-2 py-1 text-[11px] font-semibold text-[#2E7D32]">Call</a>}
        {wa && <a href={wa} target="_blank" rel="noreferrer" className="rounded-md bg-[#E8F5E9] px-2 py-1 text-[11px] font-semibold text-[#0B8A3D]">WhatsApp</a>}
      </div>
    </div>
  );
}
