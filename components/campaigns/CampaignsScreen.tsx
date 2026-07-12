"use client";

import { useState, useTransition } from "react";
import { Modal, ModalHeader } from "@/components/interactive";
import {
  SEGMENT_COLUMNS, segMeta, fillTemplate,
} from "@/lib/campaign-segments";
import {
  getSegmentMatrix, getSegmentCustomers, saveCommTemplate, createCampaign, getCampaignUplift,
  type SegmentMatrix, type CropFilter, type SegmentCustomer, type CampaignListItem, type UpliftRow, type ClusterVM, type ProjectVM,
} from "@/app/actions/campaigns";
import { createClusterFromCriteria } from "@/app/actions/cluster-builder";
import type { ClusterCriteria } from "@/lib/cluster-rules";
import { ClustersTab } from "./ClustersTab";
import { ProjectsTab } from "./ProjectsTab";

export interface CommTemplateVM {
  segment: string; priority: number; medium: string; offer: string; timingLabel: string; template: string;
}
export interface StoreLite { id: number; name: string }

const CARD = "rounded-[14px] border border-black/[0.04] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]";
const CROPS: { key: CropFilter; label: string }[] = [
  { key: "all", label: "All crops" }, { key: "maize", label: "Maize" },
  { key: "potato", label: "Potato" }, { key: "both", label: "Maize + Potato" },
];
const n = (x: number) => x.toLocaleString("en-IN");

/* ══════════════════ Segments matrix (WF2) ══════════════════ */
function SegmentsTab({ initial }: { initial: SegmentMatrix }) {
  const [crop, setCrop] = useState<CropFilter>("all");
  const [matrix, setMatrix] = useState(initial);
  const [loading, start] = useTransition();
  const [cell, setCell] = useState<{ storeId: number | null; storeName: string; seg: string } | null>(null);
  const [rows, setRows] = useState<SegmentCustomer[] | null>(null);

  const pickCrop = (c: CropFilter) => {
    setCrop(c);
    start(async () => setMatrix(await getSegmentMatrix(c)));
  };
  const openCell = (storeId: number | null, storeName: string, seg: string) => {
    setCell({ storeId, storeName, seg });
    setRows(null);
    getSegmentCustomers(storeId, seg, crop).then(setRows);
  };

  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [savingCluster, startSaveCluster] = useTransition();
  const saveCellAsCluster = () => {
    if (!cell) return;
    setSavedMsg(null);
    const cropTags = crop === "maize" ? ["maize"] : crop === "potato" ? ["potato"] : crop === "both" ? ["maize", "potato"] : undefined;
    const criteria: ClusterCriteria = {
      storeIds: cell.storeId != null ? [cell.storeId] : undefined,
      campaignSegments: [cell.seg],
      cropTags,
    };
    startSaveCluster(async () => {
      const res = await createClusterFromCriteria({
        name: `${cell.storeName} · ${segMeta(cell.seg).label}`,
        criteria, origin: "segment", mode: "dynamic",
      });
      setSavedMsg(res.ok ? "✓ Saved as a live cluster — open the Clusters tab." : res.error ?? "Failed");
    });
  };

  return (
    <div>
      {/* Priority summary */}
      <div className="mb-4 grid grid-cols-2 gap-[14px] sm:grid-cols-3 lg:grid-cols-6">
        {SEGMENT_COLUMNS.map((s) => {
          const m = segMeta(s);
          return (
            <div key={s} className={`${CARD} p-3.5`} style={{ borderTop: `3px solid ${m.color}` }}>
              <div className="text-[11px] font-bold uppercase tracking-[0.4px]" style={{ color: m.color }}>{m.label}</div>
              <div className="mt-1 text-[22px] font-bold text-[#1A1C1A]">{n(matrix.totals[s] ?? 0)}</div>
              <div className="mt-0.5 text-[10.5px] text-[#9E9E9E]">{m.medium}</div>
            </div>
          );
        })}
      </div>

      {/* Crop selector */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.6px] text-[#9E9E9E]">Crop:</span>
        {CROPS.map((c) => (
          <button key={c.key} type="button" onClick={() => pickCrop(c.key)}
            className="rounded-[20px] border-[1.5px] px-3.5 py-1.5 text-[12px] font-semibold transition-colors"
            style={{ background: crop === c.key ? "#1A3A1A" : "#fff", color: crop === c.key ? "#fff" : "#616161", borderColor: crop === c.key ? "#1A3A1A" : "#E0E0E0" }}>
            {c.label}
          </button>
        ))}
        {loading && <span className="text-[12px] text-[#9E9E9E]">Updating…</span>}
      </div>

      {/* Matrix */}
      <div className={`${CARD} overflow-hidden`}>
        <div className="overflow-x-auto">
          <div className="min-w-[820px]">
            <div className="grid grid-cols-[1.4fr_repeat(6,1fr)_0.8fr] border-b border-[#F0F0F0] bg-[#FAFAFA] px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.4px] text-[#9E9E9E]">
              <div>Store</div>
              {SEGMENT_COLUMNS.map((s) => <div key={s} className="text-right" style={{ color: segMeta(s).color }}>{segMeta(s).label}</div>)}
              <div className="text-right">Total</div>
            </div>
            {matrix.rows.length === 0 ? (
              <div className="px-4 py-10 text-center text-[13px] text-[#9E9E9E]">No farmers for this crop filter.</div>
            ) : (
              <>
                <div className="grid grid-cols-[1.4fr_repeat(6,1fr)_0.8fr] border-b border-[#EEE] bg-[#F5FBF5] px-4 py-2.5 text-[12px] font-bold text-[#1A1C1A]">
                  <div>All stores</div>
                  {SEGMENT_COLUMNS.map((s) => <div key={s} className="text-right">{n(matrix.totals[s] ?? 0)}</div>)}
                  <div className="text-right">{n(matrix.grandTotal)}</div>
                </div>
                {matrix.rows.slice(0, 200).map((r) => (
                  <div key={String(r.storeId)} className="grid grid-cols-[1.4fr_repeat(6,1fr)_0.8fr] items-center border-b border-[#F8F8F8] px-4 py-2 text-[12px]">
                    <div className="truncate font-semibold text-[#1A1C1A]" title={r.storeName}>{r.storeName}</div>
                    {SEGMENT_COLUMNS.map((s) => {
                      const c = r.counts[s] ?? 0;
                      return (
                        <div key={s} className="text-right">
                          {c > 0 ? (
                            <button type="button" onClick={() => openCell(r.storeId, r.storeName, s)}
                              className="rounded px-1.5 py-0.5 font-semibold hover:underline" style={{ color: segMeta(s).color }}>
                              {n(c)}
                            </button>
                          ) : <span className="text-[#DDD]">·</span>}
                        </div>
                      );
                    })}
                    <div className="text-right font-bold text-[#1A1C1A]">{n(r.total)}</div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
      <div className="mt-2 text-[11px] text-[#9E9E9E]">Click any count to see that store × segment customer list. Segments are exclusive — each farmer appears once.</div>

      {/* Drill-down */}
      <Modal open={!!cell} onClose={() => setCell(null)} className="max-w-[720px]">
        {cell && (
          <>
            <ModalHeader
              eyebrow={`${cell.storeName} · ${segMeta(cell.seg).label}`}
              eyebrowColor={segMeta(cell.seg).color}
              title="Customer list"
              subtitle={`Recommended: ${segMeta(cell.seg).medium}`}
              onClose={() => setCell(null)}
            />
            <div className="flex items-center justify-between gap-2 px-5 pt-3">
              <div className="text-[11.5px] font-medium text-[#2E7D32]">{savedMsg}</div>
              <button
                type="button"
                onClick={saveCellAsCluster}
                disabled={savingCluster}
                className="rounded-[8px] bg-[#2E7D32] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#1B5E20] disabled:opacity-50"
              >
                {savingCluster ? "Saving…" : "＋ Save as cluster"}
              </button>
            </div>
            <div className="max-h-[62vh] overflow-y-auto px-5 py-4">
              {rows == null ? (
                <div className="py-8 text-center text-[13px] text-[#9E9E9E]">Loading…</div>
              ) : rows.length === 0 ? (
                <div className="py-8 text-center text-[13px] text-[#9E9E9E]">No customers.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-[12.5px]">
                    <thead>
                      <tr className="border-b border-[#EEE] text-[10px] font-bold uppercase text-[#9E9E9E]">
                        <th className="py-2">Farmer</th><th>Village</th><th className="text-right">P12M spend</th>
                        <th className="text-right">Gap→HNI</th><th>Last item</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((f) => (
                        <tr key={f.id} className="border-b border-[#F5F5F5]">
                          <td className="py-2">
                            <div className="font-semibold text-[#1A1C1A]">{f.name}</div>
                            <div className="text-[11px] text-[#9E9E9E]">{f.mobile ?? "—"}</div>
                          </td>
                          <td className="text-[#616161]">{f.village ?? "—"}</td>
                          <td className="text-right font-semibold text-[#1A1C1A]">{f.spend}</td>
                          <td className="text-right text-[#E65100]">{f.gap ?? "—"}</td>
                          <td className="text-[11.5px] text-[#616161]">{f.lastItem ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rows.length >= 500 && <div className="mt-2 text-[11px] text-[#9E9E9E]">Showing first 500 by spend.</div>}
                </div>
              )}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

/* ══════════════════ Comm plan (WF3) ══════════════════ */
const SAMPLE = { name: "Ramesh Kumar", hniGap: 2500, lastItem: "Maize Dekalb 9108", store: "Ram Nagar", phone: "98xxxxxxxx", deadline: "15 Aug" };

function CommPlanTab({ templates }: { templates: CommTemplateVM[] }) {
  const [rows, setRows] = useState(templates);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<CommTemplateVM | null>(null);
  const [saving, start] = useTransition();

  const save = () => {
    if (!draft) return;
    start(async () => {
      const res = await saveCommTemplate(draft.segment, { medium: draft.medium, offer: draft.offer, timingLabel: draft.timingLabel, template: draft.template });
      if (res.ok) { setRows((r) => r.map((x) => (x.segment === draft.segment ? draft : x))); setEditing(null); }
    });
  };

  return (
    <div className="flex flex-col gap-3.5">
      <div className="text-[12.5px] text-[#757575]">One approved message per segment. Slots — <b>[Naam]</b>, <b>[gap]</b>, <b>[last item]</b>, <b>[Store name]</b>, <b>[number]</b>, <b>[date]</b> — fill per customer.</div>
      {rows.map((t) => {
        const m = segMeta(t.segment);
        const isEditing = editing === t.segment;
        const cur = isEditing && draft ? draft : t;
        return (
          <div key={t.segment} className={`${CARD} p-[18px]`} style={{ borderLeft: `4px solid ${m.color}` }}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold" style={{ background: m.bg, color: m.color }}>#{t.priority} {m.label}</span>
              <span className="text-[11.5px] text-[#616161]">{cur.medium}</span>
              <span className="text-[11.5px] text-[#9E9E9E]">· {cur.timingLabel}</span>
              <button type="button" onClick={() => { setEditing(isEditing ? null : t.segment); setDraft({ ...t }); }}
                className="ml-auto text-[12px] font-semibold text-[#2E7D32] hover:underline">{isEditing ? "Cancel" : "Edit"}</button>
            </div>
            {isEditing && draft ? (
              <div className="flex flex-col gap-2">
                <input className="rounded-lg border border-[#E0E0E0] px-3 py-2 text-[13px]" value={draft.medium} onChange={(e) => setDraft({ ...draft, medium: e.target.value })} placeholder="Medium" />
                <input className="rounded-lg border border-[#E0E0E0] px-3 py-2 text-[13px]" value={draft.offer} onChange={(e) => setDraft({ ...draft, offer: e.target.value })} placeholder="Offer" />
                <input className="rounded-lg border border-[#E0E0E0] px-3 py-2 text-[13px]" value={draft.timingLabel} onChange={(e) => setDraft({ ...draft, timingLabel: e.target.value })} placeholder="Timing" />
                <textarea className="min-h-[90px] rounded-lg border border-[#E0E0E0] px-3 py-2 text-[13px]" value={draft.template} onChange={(e) => setDraft({ ...draft, template: e.target.value })} />
                <button type="button" onClick={save} disabled={saving} className="self-start rounded-[10px] bg-[#2E7D32] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
              </div>
            ) : (
              <>
                <div className="text-[10px] font-bold uppercase text-[#9E9E9E]">Offer</div>
                <div className="mb-2 text-[12.5px] text-[#424242]">{cur.offer}</div>
                <div className="rounded-[10px] bg-[#FAFFF9] border border-[#E8F5E9] p-3 text-[12.5px] leading-[1.6] text-[#33691E]">{cur.template}</div>
                <div className="mt-2 text-[10px] font-bold uppercase text-[#9E9E9E]">Preview (sample customer)</div>
                <div className="mt-1 rounded-[10px] bg-[#F5F7F5] p-3 text-[12.5px] italic leading-[1.6] text-[#424242]">{fillTemplate(cur.template, SAMPLE)}</div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ══════════════════ Campaigns + tracking (WF4) ══════════════════ */
function CampaignsTab({ campaigns, projects }: { campaigns: CampaignListItem[]; projects: ProjectVM[] }) {
  const [list] = useState(campaigns);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [startDate, setStart] = useState("2026-07-20");
  const [endDate, setEnd] = useState("2026-08-31");
  const [projectId, setProjectId] = useState<number | null>(projects[0]?.id ?? null);
  const [clusterId, setClusterId] = useState<number | null>(null); // null = whole project
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [uplift, setUplift] = useState<UpliftRow[] | null>(null);

  const project = projects.find((p) => p.id === projectId) ?? null;
  const audience = clusterId
    ? project?.clusters.find((c) => c.id === clusterId)?.count ?? 0
    : project?.audienceCount ?? 0;

  const pickProject = (id: number) => { setProjectId(id); setClusterId(null); };

  const submit = () => {
    if (!projectId) { setMsg("Pick a project first."); return; }
    if (!name.trim()) { setMsg("Name the campaign."); return; }
    setMsg(null);
    start(async () => {
      const res = await createCampaign({ name, startDate, endDate, projectId, clusterId });
      if (res.ok) { setMsg(`Created "${name}" · ${res.members} farmers enrolled (75/25 test/control).`); setCreating(false); location.reload(); }
      else setMsg(res.error ?? "Failed");
    });
  };
  const openUplift = (id: number) => { setOpenId(id); setUplift(null); getCampaignUplift(id).then(setUplift); };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[13px] text-[#757575]">Run a campaign on a project (all its clusters) or one cluster inside it. Members are snapshot now and auto-split 75% test / 25% control.</div>
        <button type="button" onClick={() => setCreating((v) => !v)} disabled={projects.length === 0} className="rounded-[10px] bg-[#2E7D32] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50">{creating ? "Close" : "+ New campaign"}</button>
      </div>

      {projects.length === 0 && (
        <div className="mb-3 rounded-[10px] border border-[#FFE0B2] bg-[#FFF8E1] px-3.5 py-2.5 text-[12.5px] text-[#8D6E00]">
          Create a project first (Projects tab) — campaigns run on a project or one of its clusters.
        </div>
      )}

      {creating && project && (
        <div className={`${CARD} mb-4 p-[18px]`}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div><label className="text-[11px] font-semibold uppercase text-[#9E9E9E]">Name</label><input className="mt-1 w-full rounded-lg border border-[#E0E0E0] px-3 py-2 text-[13px]" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kharif HNI Push" /></div>
            <div><label className="text-[11px] font-semibold uppercase text-[#9E9E9E]">Start</label><input type="date" className="mt-1 w-full rounded-lg border border-[#E0E0E0] px-3 py-2 text-[13px]" value={startDate} onChange={(e) => setStart(e.target.value)} /></div>
            <div><label className="text-[11px] font-semibold uppercase text-[#9E9E9E]">End</label><input type="date" className="mt-1 w-full rounded-lg border border-[#E0E0E0] px-3 py-2 text-[13px]" value={endDate} onChange={(e) => setEnd(e.target.value)} /></div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[11px] font-semibold uppercase text-[#9E9E9E]">Project</label>
              <select className="mt-1 w-full rounded-lg border border-[#E0E0E0] bg-white px-2.5 py-2 text-[13px]" value={projectId ?? ""} onChange={(e) => pickProject(Number(e.target.value))}>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase text-[#9E9E9E]">Scope</label>
              <select className="mt-1 w-full rounded-lg border border-[#E0E0E0] bg-white px-2.5 py-2 text-[13px]" value={clusterId ?? ""} onChange={(e) => setClusterId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Whole project ({project.clusters.length} clusters)</option>
                {project.clusters.map((c) => <option key={c.id} value={c.id}>{c.name} · {n(c.count)}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-[10px] bg-[#F5F7F5] px-4 py-3">
            <div className="text-[12px] text-[#616161]">Audience {clusterId ? "(cluster)" : "(project, de-duplicated)"}</div>
            <div className="text-[18px] font-bold text-[#2E7D32]">{n(audience)}</div>
          </div>
          <button type="button" onClick={submit} disabled={pending || !name.trim()} className="mt-4 rounded-[10px] bg-[#2E7D32] px-5 py-2 text-[13px] font-semibold text-white disabled:opacity-50">{pending ? "Creating…" : "Create & enrol"}</button>
        </div>
      )}
      {msg && <div className="mb-3 rounded-[10px] border border-[#A5D6A7] bg-[#E8F5E9] px-3.5 py-2.5 text-[12.5px] font-medium text-[#2E7D32]">{msg}</div>}

      <div className={`${CARD} overflow-hidden`}>
        {list.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-[#9E9E9E]">No campaigns yet.</div>
        ) : list.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-3 border-b border-[#F5F5F5] px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-bold text-[#1A1C1A]">{c.name}</div>
              <div className="text-[11.5px] text-[#9E9E9E]">{c.startDate} → {c.endDate} · {c.target}</div>
            </div>
            <div className="text-[12px] text-[#616161]">{n(c.members)} farmers</div>
            <button type="button" onClick={() => openUplift(c.id)} className="rounded-[8px] bg-[#F5F7F5] px-3 py-1.5 text-[12px] font-semibold text-[#2E7D32] hover:bg-[#E8F5E9]">Uplift</button>
          </div>
        ))}
      </div>

      <Modal open={openId != null} onClose={() => setOpenId(null)} className="max-w-[760px]">
        <ModalHeader eyebrow="Campaign" eyebrowColor="#2E7D32" title="Uplift dashboard" subtitle="Test vs control · purchases within the campaign window" onClose={() => setOpenId(null)} />
        <div className="max-h-[64vh] overflow-y-auto px-5 py-4">
          {uplift == null ? <div className="py-8 text-center text-[13px] text-[#9E9E9E]">Loading…</div>
            : uplift.length === 0 ? <div className="py-8 text-center text-[13px] text-[#9E9E9E]">No members / no sales in window yet. Uplift matures once the campaign period's sales are imported.</div>
            : (
              <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-[12px]">
                <thead><tr className="border-b border-[#EEE] text-[10px] font-bold uppercase text-[#9E9E9E]">
                  <th className="py-2">Segment</th><th className="text-right">Test</th><th className="text-right">Reached</th><th className="text-right">Test %buy</th><th className="text-right">Ctrl %buy</th><th className="text-right">Uplift</th><th className="text-right">Incremental ₹</th>
                </tr></thead>
                <tbody>{uplift.map((u) => { const testPct = u.test.reached > 0 ? (u.test.purchased / u.test.reached) : (u.test.farmers ? u.test.purchased / u.test.farmers : 0); const ctrlPct = u.control.farmers ? u.control.purchased / u.control.farmers : 0; return (
                  <tr key={u.segment} className="border-b border-[#F5F5F5]">
                    <td className="py-2 font-semibold" style={{ color: segMeta(u.segment).color }}>{segMeta(u.segment).label}</td>
                    <td className="text-right">{n(u.test.farmers)}</td>
                    <td className="text-right">{n(u.test.reached)}</td>
                    <td className="text-right">{(testPct * 100).toFixed(0)}%</td>
                    <td className="text-right">{(ctrlPct * 100).toFixed(0)}%</td>
                    <td className="text-right font-semibold" style={{ color: u.upliftPurchasePct >= 0 ? "#2E7D32" : "#C62828" }}>{u.upliftPurchasePct > 0 ? "+" : ""}{u.upliftPurchasePct}pp</td>
                    <td className="text-right font-bold text-[#1A1C1A]">₹{n(u.incremental)}</td>
                  </tr>
                ); })}</tbody>
              </table></div>
            )}
        </div>
      </Modal>
    </div>
  );
}

/* ══════════════════ Shell ══════════════════ */
export function CampaignsScreen({ initialMatrix, templates, campaigns, stores: _stores, clusters, projects, zones }: {
  initialMatrix: SegmentMatrix; templates: CommTemplateVM[]; campaigns: CampaignListItem[]; stores: StoreLite[]; clusters: ClusterVM[]; projects: ProjectVM[]; zones: string[];
}) {
  const [tab, setTab] = useState<"clusters" | "projects" | "segments" | "comms" | "campaigns">("clusters");
  const TABS = [["clusters", "1 · Clusters"], ["projects", "2 · Projects"], ["campaigns", "3 · Campaigns"], ["segments", "Segments"], ["comms", "Comm Plan"]] as const;
  return (
    <div className="animate-[fadeUp_0.4s_ease-out]">
      <div className="mb-4 inline-flex flex-wrap rounded-[10px] border border-[#E0E0E0] bg-[#F5F7F5] p-1">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className="rounded-[8px] px-4 py-2 text-[12.5px] font-semibold transition-colors"
            style={{ background: tab === k ? "#fff" : "transparent", color: tab === k ? "#2E7D32" : "#9E9E9E", boxShadow: tab === k ? "0 1px 3px rgba(0,0,0,0.12)" : "none" }}>
            {label}
          </button>
        ))}
      </div>
      {tab === "clusters" && <ClustersTab initial={clusters} zones={zones} />}
      {tab === "projects" && <ProjectsTab initial={projects} clusters={clusters} />}
      {tab === "segments" && <SegmentsTab initial={initialMatrix} />}
      {tab === "comms" && <CommPlanTab templates={templates} />}
      {tab === "campaigns" && <CampaignsTab campaigns={campaigns} projects={projects} />}
    </div>
  );
}
