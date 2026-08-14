"use client";

import { useEffect, useState, useTransition } from "react";
import { Modal, ModalHeader } from "@/components/interactive";
import {
  getCampaignPhaseConfig, saveCampaignPhases, setCampaignCategories, getProductCategoryOptions,
  recomputeCampaignStatuses, getRoundStatus, advanceCampaignRound, getPhaseFunnel,
  type CampaignPhaseConfig, type PhaseVM, type PhaseInput, type RoundStatus, type PhaseFunnel,
} from "@/app/actions/campaign-phases";
import {
  PHASE_TYPES, CHANNELS, DEFAULT_PHASES, subCohortsFor, type Coupon, type CommConfig, type Channel,
} from "@/lib/campaign-phases";

type Tab = "define" | "categories" | "status";
const LBL = "text-[11px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]";
const INPUT = "rounded-[10px] border border-[#E0E0E0] px-3 py-2 text-[13px] outline-none focus:border-[#2E7D32]";
const BTN = "rounded-[10px] px-4 py-2 text-[12.5px] font-semibold";

export function PhasesPanel({
  campaignId, campaignName, campaignStart, campaignEnd, commPlanNames, onClose,
}: {
  campaignId: number; campaignName: string; campaignStart: string; campaignEnd: string;
  commPlanNames: string[]; onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("define");
  const [cfg, setCfg] = useState<CampaignPhaseConfig | null>(null);
  const [cats, setCats] = useState<string[]>([]);

  const load = () => getCampaignPhaseConfig(campaignId).then((c) => { if (c) setCfg(c); });
  useEffect(() => { load(); getProductCategoryOptions().then(setCats); }, [campaignId]); // eslint-disable-line

  return (
    <Modal open onClose={onClose} className="max-w-[1080px]">
      <ModalHeader eyebrow="Campaign · rounds" eyebrowColor="#2E7D32" title={campaignName}
        subtitle={`${campaignStart} → ${campaignEnd} · define rounds, map sale categories, advance the campaign`} onClose={onClose} />
      <div className="px-5 py-4">
        <div className="mb-4 inline-flex rounded-[10px] border border-[#E0E0E0] bg-[#F5F7F5] p-1">
          {([["define", "Rounds"], ["categories", "Categories"], ["status", "Round status"]] as [Tab, string][]).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className="rounded-[8px] px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors"
              style={{ background: tab === k ? "#fff" : "transparent", color: tab === k ? "#2E7D32" : "#9E9E9E", boxShadow: tab === k ? "0 1px 3px rgba(0,0,0,0.12)" : "none" }}>
              {l}
            </button>
          ))}
        </div>

        {cfg == null ? <div className="py-10 text-center text-[13px] text-[#9E9E9E]">Loading…</div> : (
          <>
            {tab === "define" && <DefineTab cfg={cfg} commPlanNames={commPlanNames} onSaved={load} />}
            {tab === "categories" && <CategoriesTab cfg={cfg} allCategories={cats} onSaved={load} />}
            {tab === "status" && <RoundStatusTab campaignId={campaignId} />}
          </>
        )}
      </div>
    </Modal>
  );
}

/* ─────────────────── Define tab: rounds + dates + coupons + messaging ─────────────────── */

function DefineTab({ cfg, commPlanNames, onSaved }: { cfg: CampaignPhaseConfig; commPlanNames: string[]; onSaved: () => void }) {
  const [phases, setPhases] = useState<PhaseVM[]>(cfg.phases);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  const seedDefault = () => {
    setPhases(DEFAULT_PHASES.map((t) => ({
      id: -t.ordinal, ordinal: t.ordinal, name: t.name, type: t.type,
      defaultStart: cfg.campaignStart, defaultEnd: cfg.campaignEnd, coupons: [], commConfig: {},
    })));
  };
  const patch = (i: number, p: Partial<PhaseVM>) => setPhases((ps) => ps.map((x, j) => j === i ? { ...x, ...p } : x));
  const addPhase = () => setPhases((ps) => [...ps, {
    id: -(ps.length + 1) - 100, ordinal: (ps.at(-1)?.ordinal ?? 0) + 1, name: `Round ${(ps.at(-1)?.ordinal ?? 0) + 1}`,
    type: "CUSTOM", defaultStart: cfg.campaignStart, defaultEnd: cfg.campaignEnd, coupons: [], commConfig: {},
  }]);
  const removePhase = (i: number) => setPhases((ps) => ps.filter((_, j) => j !== i).map((x, k) => ({ ...x, ordinal: k + 1 })));

  const save = () => {
    setErr(null); setMsg(null);
    const input: PhaseInput[] = phases.map((p) => ({
      ordinal: p.ordinal, name: p.name, type: p.type, defaultStart: p.defaultStart, defaultEnd: p.defaultEnd,
      coupons: p.coupons, commConfig: p.commConfig,
    }));
    startSave(async () => {
      const r = await saveCampaignPhases(cfg.campaignId, input);
      if (!r.ok) { setErr(r.error ?? "Save failed."); return; }
      setMsg("Rounds saved."); onSaved();
    });
  };

  if (phases.length === 0) {
    return (
      <div className="rounded-[12px] border border-dashed border-[#C8E6C9] bg-[#F1F8F1] px-5 py-10 text-center">
        <div className="text-[14px] font-bold text-[#1B5E20]">No rounds defined yet</div>
        <div className="mt-1 text-[12.5px] text-[#66857A]">Start with the standard Advance Booking → Fertiliser → Combo flow, then tweak dates &amp; messaging.</div>
        <button type="button" onClick={seedDefault} className={`${BTN} mt-4 bg-[#2E7D32] text-white`}>Create default 3 rounds</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[11.5px] text-[#9E9E9E]">Each round auto-routes farmers into sub-cohorts by their purchase status. Dates &amp; coupons apply to the whole campaign — store-level differences are handled with separate clusters.</div>
      {phases.map((p, i) => (
        <PhaseCard key={p.id} phase={p} commPlanNames={commPlanNames}
          onPatch={(x) => patch(i, x)} onRemove={() => removePhase(i)} canRemove={phases.length > 1} />
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={addPhase} className={`${BTN} border border-[#E0E0E0] text-[#616161] hover:bg-[#F5F5F5]`}>+ Add round</button>
        <div className="ml-auto flex items-center gap-2">
          {err && <span className="text-[12px] font-semibold text-[#C62828]">{err}</span>}
          {msg && <span className="text-[12px] font-semibold text-[#2E7D32]">{msg}</span>}
          <button type="button" onClick={save} disabled={saving} className={`${BTN} bg-[#2E7D32] text-white disabled:opacity-50`}>{saving ? "Saving…" : "Save rounds"}</button>
        </div>
      </div>
    </div>
  );
}

function PhaseCard({ phase, commPlanNames, onPatch, onRemove, canRemove }: {
  phase: PhaseVM; commPlanNames: string[];
  onPatch: (p: Partial<PhaseVM>) => void; onRemove: () => void; canRemove: boolean;
}) {
  const cohorts = subCohortsFor(phase.type);
  const setCoupon = (ci: number, c: Partial<Coupon>) => onPatch({ coupons: phase.coupons.map((x, j) => j === ci ? { ...x, ...c } : x) });
  const addCoupon = () => onPatch({ coupons: [...phase.coupons, { label: "", code: "" }] });
  const rmCoupon = (ci: number) => onPatch({ coupons: phase.coupons.filter((_, j) => j !== ci) });
  const setComm = (cohort: string, band: "HNI" | "OTHERS", slot: { commPlan?: string; channel?: Channel }) => {
    const cc: CommConfig = { ...phase.commConfig, [cohort]: { ...(phase.commConfig[cohort] ?? {}), [band]: { ...(phase.commConfig[cohort]?.[band] ?? {}), ...slot } } };
    onPatch({ commConfig: cc });
  };

  return (
    <div className="rounded-[12px] border border-[#EAEAEA] bg-white p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid h-7 w-7 place-items-center rounded-full bg-[#2E7D32] text-[12px] font-bold text-white">{phase.ordinal}</div>
        <div className="flex-1 min-w-[160px]">
          <label className={LBL}>Round name</label>
          <input value={phase.name} onChange={(e) => onPatch({ name: e.target.value })} className={`${INPUT} mt-1 w-full`} />
        </div>
        <div>
          <label className={LBL}>Type (routing)</label>
          <select value={phase.type} onChange={(e) => onPatch({ type: e.target.value })} className={`${INPUT} mt-1 bg-white`}>
            {PHASE_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className={LBL}>Start</label>
          <input type="date" value={phase.defaultStart} onChange={(e) => onPatch({ defaultStart: e.target.value })} className={`${INPUT} mt-1`} />
        </div>
        <div>
          <label className={LBL}>End</label>
          <input type="date" value={phase.defaultEnd} onChange={(e) => onPatch({ defaultEnd: e.target.value })} className={`${INPUT} mt-1`} />
        </div>
        {canRemove && <button type="button" onClick={onRemove} className="rounded-md bg-[#FDECEA] px-2 py-1.5 text-[11px] font-semibold text-[#C62828] hover:bg-[#FADBD8]">Remove</button>}
      </div>

      <div className="mt-3 border-t border-[#F5F5F5] pt-3">
        <div className="mb-1.5 flex items-center justify-between"><span className={LBL}>Offers / coupons (fill message [coupon])</span>
          <button type="button" onClick={addCoupon} className="text-[11px] font-semibold text-[#2E7D32]">+ Add coupon</button></div>
        {phase.coupons.length === 0 ? <div className="text-[11.5px] text-[#BDBDBD]">No coupons for this round.</div> : (
          <div className="flex flex-col gap-1.5">
            {phase.coupons.map((c, ci) => (
              <div key={ci} className="flex flex-wrap items-center gap-2">
                <input value={c.label} onChange={(e) => setCoupon(ci, { label: e.target.value })} placeholder="Rs 300 off" className={`${INPUT} w-[150px]`} />
                <input value={c.code} onChange={(e) => setCoupon(ci, { code: e.target.value.toUpperCase() })} placeholder="POT300" className={`${INPUT} w-[120px] font-mono`} />
                <input type="number" value={c.minSpend ?? ""} onChange={(e) => setCoupon(ci, { minSpend: e.target.value ? Number(e.target.value) : undefined })} placeholder="min ₹" className={`${INPUT} w-[90px]`} />
                <button type="button" onClick={() => rmCoupon(ci)} className="text-[11px] font-semibold text-[#C62828]">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 border-t border-[#F5F5F5] pt-3">
        <div className={`${LBL} mb-1.5`}>Messaging — who to contact &amp; how</div>
        <div className="flex flex-col gap-2">
          {cohorts.map((co) => (
            <div key={co.key} className="rounded-[10px] bg-[#FAFBFA] p-2.5">
              <div className="text-[12px] font-semibold text-[#1A1C1A]">{co.label} <span className="font-normal text-[#9E9E9E]">— {co.goal}</span></div>
              <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(["HNI", "OTHERS"] as const).map((band) => {
                  const slot = phase.commConfig[co.key]?.[band] ?? {};
                  return (
                    <div key={band} className="flex items-center gap-1.5">
                      <span className="w-[52px] text-[11px] font-bold" style={{ color: band === "HNI" ? "#6A1B9A" : "#00838F" }}>{band === "HNI" ? "HNI" : "Others"}</span>
                      <select value={slot.commPlan ?? ""} onChange={(e) => setComm(co.key, band, { commPlan: e.target.value || undefined })} className={`${INPUT} min-w-0 flex-1 bg-white`}>
                        <option value="">Comm plan…</option>
                        {commPlanNames.map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <select value={slot.channel ?? ""} onChange={(e) => setComm(co.key, band, { channel: (e.target.value || undefined) as Channel | undefined })} className={`${INPUT} bg-white`}>
                        <option value="">Channel…</option>
                        {CHANNELS.map((ch) => <option key={ch.key} value={ch.key}>{ch.label}</option>)}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────── Categories tab ─────────────────── */

function CategoriesTab({ cfg, allCategories, onSaved }: { cfg: CampaignPhaseConfig; allCategories: string[]; onSaved: () => void }) {
  const [fert, setFert] = useState<string[]>(cfg.fertiliserCategories);
  const [combo, setCombo] = useState<string[]>(cfg.comboCategories);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [recomputing, startRecompute] = useTransition();

  const toggle = (set: string[], v: string, fn: (s: string[]) => void) => fn(set.includes(v) ? set.filter((x) => x !== v) : [...set, v]);

  const save = () => startSave(async () => { await setCampaignCategories(cfg.campaignId, fert, combo); setMsg("Category mapping saved."); onSaved(); });
  const recompute = () => startRecompute(async () => {
    const r = await recomputeCampaignStatuses(cfg.campaignId);
    setMsg(r.ok ? `Recomputed from sales — ${r.fertiliser ?? 0} fertiliser, ${r.combo ?? 0} combo buyers flagged.` : (r.error ?? "Recompute failed."));
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="text-[11.5px] text-[#9E9E9E]">Map product categories (from real sales) to fertiliser vs combo. The status engine flags a farmer once a matching sale lands in the campaign window. &apos;Booked&apos; stays officer-marked (a deposit isn&apos;t a sale).</div>
      {allCategories.length === 0 ? <div className="text-[12.5px] text-[#BDBDBD]">No product categories found in sales yet.</div> : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {([["Fertiliser categories", fert, setFert, "#2E7D32"], ["Combo categories", combo, setCombo, "#6A1B9A"]] as const).map(([title, set, fn, color]) => (
            <div key={title} className="rounded-[12px] border border-[#EAEAEA] p-3">
              <div className="mb-2 text-[12.5px] font-bold" style={{ color }}>{title} <span className="font-normal text-[#9E9E9E]">({set.length})</span></div>
              <div className="flex max-h-[280px] flex-col gap-1 overflow-y-auto">
                {allCategories.map((c) => (
                  <label key={c} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[12.5px] hover:bg-[#FAFBFA]">
                    <input type="checkbox" checked={set.includes(c)} onChange={() => toggle(set, c, fn)} />
                    <span className="text-[#424242]">{c}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {msg && <span className="text-[12px] font-semibold text-[#2E7D32]">{msg}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={recompute} disabled={recomputing} className={`${BTN} border border-[#2E7D32] text-[#2E7D32] hover:bg-[#E8F5E9] disabled:opacity-50`}>{recomputing ? "Recomputing…" : "↻ Recompute from sales"}</button>
          <button type="button" onClick={save} disabled={saving} className={`${BTN} bg-[#2E7D32] text-white disabled:opacity-50`}>{saving ? "Saving…" : "Save mapping"}</button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────── Round status: current round + advance ─────────────────── */

function RoundStatusTab({ campaignId }: { campaignId: number }) {
  const [status, setStatus] = useState<RoundStatus | null>(null);
  const [funnel, setFunnel] = useState<PhaseFunnel | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const load = () => { getRoundStatus(campaignId).then(setStatus); getPhaseFunnel(campaignId).then(setFunnel); };
  useEffect(() => { load(); }, [campaignId]); // eslint-disable-line

  if (status == null) return <div className="py-10 text-center text-[13px] text-[#9E9E9E]">Loading…</div>;
  if (status.rounds.length === 0) return <div className="py-10 text-center text-[13px] text-[#9E9E9E]">No rounds defined yet.</div>;

  return (
    <div className="flex flex-col gap-4">
      {/* Round timeline */}
      <div className="flex flex-wrap items-center gap-2">
        {status.rounds.map((r) => {
          const on = r.ordinal === status.currentOrdinal;
          const done = r.ordinal < status.currentOrdinal;
          return (
            <div key={r.ordinal} className="flex items-center gap-2">
              <div className="rounded-full px-3 py-1 text-[12px] font-bold"
                style={{ background: on ? "#2E7D32" : done ? "#E8F5E9" : "#F5F5F5", color: on ? "#fff" : done ? "#2E7D32" : "#9E9E9E" }}>
                {r.ordinal}. {r.name}{done ? " ✓" : ""}
              </div>
              {r.ordinal < status.rounds.length && <span className="text-[#BDBDBD]">→</span>}
            </div>
          );
        })}
      </div>

      {/* Current round card */}
      <div className="rounded-[12px] border border-[#EAEAEA] bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="rounded-full bg-[#E8F5E9] px-2.5 py-0.5 text-[11.5px] font-bold text-[#2E7D32]">Current — Round {status.currentOrdinal}: {status.roundName}</span>
            <span className="ml-2 text-[12px] text-[#757575]">{status.windowStart} → {status.windowEnd} · {status.memberCount} test farmers</span>
            {status.advancedByName && <div className="mt-1 text-[10.5px] text-[#9E9E9E]">Last advanced by {status.advancedByName} · {status.advancedAt}</div>}
          </div>
          {status.canManage && (status.hasNext
            ? <button type="button" onClick={() => setAdvancing(true)} className={`${BTN} bg-[#2E7D32] text-white`}>→ Advance to {status.nextRoundName}</button>
            : <span className="text-[12px] font-semibold text-[#9E9E9E]">Final round</span>)}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {status.cohorts.map((c) => (
            <div key={c.key} className="flex items-baseline gap-2 rounded-[10px] bg-[#FAFBFA] px-3 py-2">
              <span className="text-[18px] font-bold text-[#1A1C1A]">{c.count}</span>
              <span className="text-[12px] text-[#616161]">{c.label} <span className="text-[#9E9E9E]">— {c.goal}</span></span>
            </div>
          ))}
        </div>
      </div>

      {/* Funnel */}
      {funnel && (
        <div>
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] text-[#757575]">
            <b className="text-[#1A1C1A]">Funnel</b> · {funnel.totalTest} test · {funnel.booked} booked · {funnel.boughtFertiliser} fertiliser · {funnel.boughtCombo} combo · {funnel.reached} contacted ({funnel.contactTouches} touches)
          </div>
          <div className="flex flex-wrap gap-2">
            {funnel.buckets.map((b) => (
              <div key={b.key} className="rounded-[10px] border border-[#EEE] bg-[#FAFBFA] px-3 py-1.5">
                <div className="text-[15px] font-bold text-[#1A1C1A]">{b.count}</div>
                <div className="text-[10.5px] text-[#9E9E9E]">{b.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {advancing && <AdvanceModal campaignId={campaignId} status={status} onClose={() => setAdvancing(false)} onDone={() => { setAdvancing(false); load(); }} />}
    </div>
  );
}

function AdvanceModal({ campaignId, status, onClose, onDone }: { campaignId: number; status: RoundStatus; onClose: () => void; onDone: () => void }) {
  const [attested, setAttested] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const go = () => {
    setErr(null);
    startSave(async () => {
      const r = await advanceCampaignRound({ campaignId, attested, note: note || undefined });
      if (!r.ok) { setErr(r.error ?? "Failed."); return; }
      onDone();
    });
  };
  return (
    <Modal open onClose={onClose} className="max-w-[460px]">
      <ModalHeader eyebrow="Advance round" eyebrowColor="#2E7D32" title={`${status.roundName} → ${status.nextRoundName}`} onClose={onClose} />
      <div className="px-5 py-4">
        <div className="rounded-[10px] bg-[#FFF8E1] px-3.5 py-2.5 text-[12px] text-[#8D6E00]">
          Moving the whole campaign from <b>{status.roundName}</b> to <b>{status.nextRoundName}</b>. Confirm the sales data for the round you&apos;re leaving is uploaded — cohorts route off that data.
        </div>
        <label className="mt-3 flex items-start gap-2 text-[13px] text-[#333]">
          <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} className="mt-0.5" />
          <span>I confirm the <b>{status.roundName}</b> sales data has been uploaded.</span>
        </label>
        <div className="mt-3">
          <label className={LBL}>Note (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. booking file uploaded 25 Sep" className={`${INPUT} mt-1 w-full`} />
        </div>
        {err && <div className="mt-3 rounded-[8px] bg-[#FDECEA] px-3 py-2 text-[12px] font-semibold text-[#C62828]">{err}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={`${BTN} border border-[#E0E0E0] text-[#616161] hover:bg-[#F5F5F5]`}>Cancel</button>
          <button type="button" onClick={go} disabled={saving || !attested} className={`${BTN} bg-[#2E7D32] text-white disabled:opacity-50`}>{saving ? "Advancing…" : "Advance"}</button>
        </div>
      </div>
    </Modal>
  );
}
