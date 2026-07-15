"use client";

import { useState, useTransition } from "react";
import { Modal, ModalHeader } from "@/components/interactive";
import { segMeta, fillTemplate } from "@/lib/campaign-segments";
import {
  saveCommTemplate, createCampaign, getCampaignUplift, extendCampaign, getCampaignMembers,
  type CampaignListItem, type UpliftRow, type ProjectVM, type CampaignMemberVM,
} from "@/app/actions/campaigns";

/** Distinct-crop option (kept here as it's imported by the Segmentation + Projects screens). */
export interface CropOption { crop: string; count: number }

export interface CommTemplateVM {
  segment: string; priority: number; medium: string; offer: string; timingLabel: string; template: string;
}
export interface StoreLite { id: number; name: string }

const CARD = "rounded-[14px] border border-black/[0.04] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]";
const n = (x: number) => x.toLocaleString("en-IN");

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
function CampaignsTab({ campaigns, projects, canManage }: { campaigns: CampaignListItem[]; projects: ProjectVM[]; canManage: boolean }) {
  const [list] = useState(campaigns);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState<number | null>(projects[0]?.id ?? null);
  const [clusterId, setClusterId] = useState<number | null>(null); // null = whole project
  const [startDate, setStart] = useState(projects[0]?.startDate ?? "");
  const [endDate, setEnd] = useState(projects[0]?.endDate ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [upliftId, setUpliftId] = useState<number | null>(null);
  const [uplift, setUplift] = useState<UpliftRow[] | null>(null);
  const [membersOf, setMembersOf] = useState<CampaignListItem | null>(null);
  const [members, setMembers] = useState<CampaignMemberVM[] | null>(null);
  const [extendOf, setExtendOf] = useState<CampaignListItem | null>(null);

  const project = projects.find((p) => p.id === projectId) ?? null;
  const audience = clusterId ? project?.clusters.find((c) => c.id === clusterId)?.count ?? 0 : project?.audienceCount ?? 0;

  const pickProject = (id: number) => {
    const p = projects.find((x) => x.id === id) ?? null;
    setProjectId(id); setClusterId(null);
    setStart(p?.startDate ?? ""); setEnd(p?.endDate ?? "");
  };

  const submit = () => {
    if (!projectId) { setMsg("Pick a project first."); return; }
    if (!name.trim()) { setMsg("Name the campaign."); return; }
    setMsg(null);
    start(async () => {
      const res = await createCampaign({ name, startDate, endDate, projectId, clusterId });
      if (res.ok) { setMsg(`Created "${name}" · ${n(res.members ?? 0)} enrolled${res.skipped ? ` · ${n(res.skipped)} skipped (already in another campaign of this project)` : ""}.`); setCreating(false); location.reload(); }
      else setMsg(res.error ?? "Failed");
    });
  };
  const openUplift = (id: number) => { setUpliftId(id); setUplift(null); getCampaignUplift(id).then(setUplift); };
  const openMembers = (c: CampaignListItem) => { setMembersOf(c); setMembers(null); getCampaignMembers(c.id).then(setMembers); };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[13px] text-[#757575]">
          {canManage
            ? "Run a campaign on a project (all its segments) or one segment inside it. Farmers already in another campaign of the same project are skipped — no double-contact."
            : "Your campaigns — showing only the farmers enrolled from your store / region."}
        </div>
        {canManage && <button type="button" onClick={() => setCreating((v) => !v)} disabled={projects.length === 0} className="rounded-[10px] bg-[#2E7D32] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50">{creating ? "Close" : "+ New campaign"}</button>}
      </div>

      {canManage && projects.length === 0 && (
        <div className="mb-3 rounded-[10px] border border-[#FFE0B2] bg-[#FFF8E1] px-3.5 py-2.5 text-[12.5px] text-[#8D6E00]">
          Create a project first (Projects page) — campaigns run on a project or one of its segments.
        </div>
      )}

      {canManage && creating && project && (
        <div className={`${CARD} mb-4 p-[18px]`}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div><label className="text-[11px] font-semibold uppercase text-[#9E9E9E]">Name</label><input className="mt-1 w-full rounded-lg border border-[#E0E0E0] px-3 py-2 text-[13px]" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kharif HNI Push" /></div>
            <div><label className="text-[11px] font-semibold uppercase text-[#9E9E9E]">Start</label><input type="date" min={project.startDate ?? undefined} max={project.endDate ?? undefined} className="mt-1 w-full rounded-lg border border-[#E0E0E0] px-3 py-2 text-[13px]" value={startDate} onChange={(e) => setStart(e.target.value)} /></div>
            <div><label className="text-[11px] font-semibold uppercase text-[#9E9E9E]">End</label><input type="date" min={startDate || project.startDate || undefined} max={project.endDate ?? undefined} className="mt-1 w-full rounded-lg border border-[#E0E0E0] px-3 py-2 text-[13px]" value={endDate} onChange={(e) => setEnd(e.target.value)} /></div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[11px] font-semibold uppercase text-[#9E9E9E]">Project</label>
              <select className="mt-1 w-full rounded-lg border border-[#E0E0E0] bg-white px-2.5 py-2 text-[13px]" value={projectId ?? ""} onChange={(e) => pickProject(Number(e.target.value))}>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.startDate ? ` (${p.startDate} → ${p.endDate})` : ""}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase text-[#9E9E9E]">Scope</label>
              <select className="mt-1 w-full rounded-lg border border-[#E0E0E0] bg-white px-2.5 py-2 text-[13px]" value={clusterId ?? ""} onChange={(e) => setClusterId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Whole project ({project.clusters.length} segments)</option>
                {project.clusters.map((c) => <option key={c.id} value={c.id}>{c.name} · {n(c.count)}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-[#9E9E9E]">Campaign dates must fall within the project window{project.endDate ? ` (${project.startDate} → ${project.endDate})` : ""}. To run past the project end, extend the project first.</div>
          <div className="mt-3 flex items-center justify-between rounded-[10px] bg-[#F5F7F5] px-4 py-3">
            <div className="text-[12px] text-[#616161]">Audience {clusterId ? "(segment)" : "(project, de-duplicated)"} · before cross-campaign de-dup</div>
            <div className="text-[18px] font-bold text-[#2E7D32]">{n(audience)}</div>
          </div>
          <button type="button" onClick={submit} disabled={pending || !name.trim()} className="mt-4 rounded-[10px] bg-[#2E7D32] px-5 py-2 text-[13px] font-semibold text-white disabled:opacity-50">{pending ? "Creating…" : "Create & enrol"}</button>
        </div>
      )}
      {msg && <div className="mb-3 rounded-[10px] border border-[#A5D6A7] bg-[#E8F5E9] px-3.5 py-2.5 text-[12.5px] font-medium text-[#2E7D32]">{msg}</div>}

      <div className={`${CARD} overflow-hidden`}>
        {list.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-[#9E9E9E]">{canManage ? "No campaigns yet." : "No campaigns assigned to your store / region yet."}</div>
        ) : list.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-3 border-b border-[#F5F5F5] px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-bold text-[#1A1C1A]">{c.name}</div>
              <div className="text-[11.5px] text-[#9E9E9E]">{c.startDate} → {c.endDate} · {c.target}</div>
            </div>
            <div className="text-[12px] text-[#616161]">{n(c.members)} farmers</div>
            <button type="button" onClick={() => openMembers(c)} className="rounded-[8px] bg-[#F5F7F5] px-3 py-1.5 text-[12px] font-semibold text-[#1565C0] hover:bg-[#E3F2FD]">Farmers</button>
            {canManage && <button type="button" onClick={() => openUplift(c.id)} className="rounded-[8px] bg-[#F5F7F5] px-3 py-1.5 text-[12px] font-semibold text-[#2E7D32] hover:bg-[#E8F5E9]">Uplift</button>}
            {canManage && <button type="button" onClick={() => setExtendOf(c)} className="rounded-[8px] bg-[#F5F7F5] px-3 py-1.5 text-[12px] font-semibold text-[#6A1B9A] hover:bg-[#F3E5F5]">Extend</button>}
          </div>
        ))}
      </div>

      {/* Scoped farmer list (all roles) */}
      <Modal open={membersOf != null} onClose={() => setMembersOf(null)} className="max-w-[720px]">
        {membersOf && (
          <>
            <ModalHeader eyebrow="Campaign" eyebrowColor="#1565C0" title={membersOf.name} subtitle={canManage ? "Enrolled farmers" : "Enrolled farmers from your store / region"} onClose={() => setMembersOf(null)} />
            <div className="max-h-[64vh] overflow-y-auto px-5 py-4">
              {members == null ? <div className="py-8 text-center text-[13px] text-[#9E9E9E]">Loading…</div>
                : members.length === 0 ? <div className="py-8 text-center text-[13px] text-[#9E9E9E]">No farmers.</div>
                : (
                  <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-[12.5px]">
                    <thead><tr className="border-b border-[#EEE] text-[10px] font-bold uppercase text-[#9E9E9E]"><th className="py-2">Farmer</th><th>Store</th><th>Segment</th><th className="text-right">Group</th></tr></thead>
                    <tbody>{members.map((m) => (
                      <tr key={m.id} className="border-b border-[#F5F5F5]">
                        <td className="py-2"><div className="font-semibold text-[#1A1C1A]">{m.name}</div><div className="text-[11px] text-[#9E9E9E]">{m.village ?? "—"} · {m.mobile ?? "—"}</div></td>
                        <td className="text-[#616161]">{m.store ?? "—"}</td>
                        <td><span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: segMeta(m.segment).bg, color: segMeta(m.segment).color }}>{segMeta(m.segment).label}</span></td>
                        <td className="text-right text-[11px] font-semibold text-[#616161]">{m.group}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                  {members.length >= 500 && <div className="mt-2 text-[11px] text-[#9E9E9E]">Showing first 500.</div>}
                  </div>
                )}
            </div>
          </>
        )}
      </Modal>

      {/* Uplift (managers only) */}
      <Modal open={upliftId != null} onClose={() => setUpliftId(null)} className="max-w-[760px]">
        <ModalHeader eyebrow="Campaign" eyebrowColor="#2E7D32" title="Uplift dashboard" subtitle="Test vs control · purchases within the campaign window" onClose={() => setUpliftId(null)} />
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

      {extendOf && <ExtendModal campaign={extendOf} project={projects.find((p) => p.id === projectId) ?? null} onClose={() => setExtendOf(null)} />}
    </div>
  );
}

function ExtendModal({ campaign, project, onClose }: { campaign: CampaignListItem; project: ProjectVM | null; onClose: () => void }) {
  const [end, setEnd] = useState(campaign.endDate);
  const [saving, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const save = () => {
    setErr(null);
    start(async () => {
      const res = await extendCampaign(campaign.id, end);
      if (res.ok) location.reload(); else setErr(res.error ?? "Failed");
    });
  };
  return (
    <Modal open onClose={onClose} className="max-w-[440px]">
      <ModalHeader eyebrow="Extend campaign" eyebrowColor="#6A1B9A" title={campaign.name} subtitle={`Currently ends ${campaign.endDate}`} onClose={onClose} />
      <div className="px-5 py-4">
        <label className="text-[11px] font-semibold uppercase text-[#9E9E9E]">New end date</label>
        <input type="date" min={campaign.endDate} max={project?.endDate ?? undefined} className="mt-1 w-full rounded-lg border border-[#E0E0E0] px-3 py-2 text-[13px]" value={end} onChange={(e) => setEnd(e.target.value)} />
        <div className="mt-1 text-[11px] text-[#9E9E9E]">Can't go past the project end. To extend further, extend the project first (Projects page).</div>
        {err && <div className="mt-2 text-[12px] text-[#C62828]">{err}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-[10px] border border-[#E0E0E0] px-4 py-2 text-[13px] font-semibold text-[#616161]">Cancel</button>
          <button type="button" onClick={save} disabled={saving} className="rounded-[10px] bg-[#6A1B9A] px-5 py-2 text-[13px] font-semibold text-white disabled:opacity-50">{saving ? "Extending…" : "Extend"}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ══════════════════ Shell ══════════════════ */
export function CampaignsScreen({ templates, campaigns, stores: _stores, projects, canManage }: {
  templates: CommTemplateVM[]; campaigns: CampaignListItem[]; stores: StoreLite[]; projects: ProjectVM[]; canManage: boolean;
}) {
  const [tab, setTab] = useState<"comms" | "campaigns">("campaigns");
  // Officers/RMs get the scoped campaign view only; the comm-plan config is central.
  const TABS: [("comms" | "campaigns"), string][] = canManage
    ? [["campaigns", "Campaigns"], ["comms", "Comm Plan"]]
    : [["campaigns", "Campaigns"]];
  return (
    <div className="animate-[fadeUp_0.4s_ease-out]">
      {canManage && (
        <div className="mb-4 inline-flex flex-wrap rounded-[10px] border border-[#E0E0E0] bg-[#F5F7F5] p-1">
          {TABS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className="rounded-[8px] px-4 py-2 text-[12.5px] font-semibold transition-colors"
              style={{ background: tab === k ? "#fff" : "transparent", color: tab === k ? "#2E7D32" : "#9E9E9E", boxShadow: tab === k ? "0 1px 3px rgba(0,0,0,0.12)" : "none" }}>
              {label}
            </button>
          ))}
        </div>
      )}
      {tab === "comms" && canManage && <CommPlanTab templates={templates} />}
      {tab === "campaigns" && <CampaignsTab campaigns={campaigns} projects={projects} canManage={canManage} />}
    </div>
  );
}
