"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Modal, ModalHeader } from "@/components/interactive";
import { segMeta, fillTemplate } from "@/lib/campaign-segments";
import { inr } from "@/lib/format";
import {
  saveCommTemplate, createCampaign, getCampaignTracker, extendCampaign, getCampaignMembers, markCampaignMember,
  type CampaignListItem, type CampaignTracker, type ProjectVM, type CampaignMemberVM,
} from "@/app/actions/campaigns";

/** Distinct-crop option (kept here as it's imported by the Farmer Clusters + Projects screens). */
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
function CampaignsTab({ campaigns, projects, canManage, initialProjectId }: { campaigns: CampaignListItem[]; projects: ProjectVM[]; canManage: boolean; initialProjectId?: number }) {
  // Chain: arriving via /campaigns?forProject=<id> opens the create form with that project preselected.
  const initialProject = initialProjectId != null ? projects.find((p) => p.id === initialProjectId) ?? null : null;
  const defaultProject = initialProject ?? projects[0] ?? null;
  const [list] = useState(campaigns);
  const [creating, setCreating] = useState(canManage && initialProject != null);
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState<number | null>(defaultProject?.id ?? null);
  const [clusterId, setClusterId] = useState<number | null>(null); // null = whole project
  const [startDate, setStart] = useState(defaultProject?.startDate ?? "");
  const [endDate, setEnd] = useState(defaultProject?.endDate ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [trackerOf, setTrackerOf] = useState<CampaignListItem | null>(null);
  const [tracker, setTracker] = useState<CampaignTracker | null>(null);
  const [membersOf, setMembersOf] = useState<CampaignListItem | null>(null);
  const [members, setMembers] = useState<CampaignMemberVM[] | null>(null);
  const [memberPage, setMemberPage] = useState(0);
  const [focusMode, setFocusMode] = useState(false);
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
  const openTracker = (c: CampaignListItem) => { setTrackerOf(c); setTracker(null); getCampaignTracker(c.id).then(setTracker); };
  const openMembers = (c: CampaignListItem) => { setMembersOf(c); setMembers(null); setMemberPage(0); setFocusMode(false); getCampaignMembers(c.id).then(setMembers); };
  const patchMember = (u: CampaignMemberVM) => setMembers((list) => list?.map((x) => (x.id === u.id ? u : x)) ?? null);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[13px] text-[#757575]">
          {canManage
            ? "Run a campaign on a project (all its clusters) or one cluster inside it. Farmers already in another campaign of the same project are skipped — no double-contact."
            : "Your campaigns — showing only the farmers enrolled from your store / region."}
        </div>
        {canManage && <button type="button" onClick={() => setCreating((v) => !v)} disabled={projects.length === 0} className="rounded-[10px] bg-[#2E7D32] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50">{creating ? "Close" : "+ New campaign"}</button>}
      </div>

      {canManage && projects.length === 0 && (
        <div className="mb-3 rounded-[10px] border border-[#FFE0B2] bg-[#FFF8E1] px-3.5 py-2.5 text-[12.5px] text-[#8D6E00]">
          Create a project first (Projects page) — campaigns run on a project or one of its clusters.
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
                <option value="">Whole project ({project.clusters.length} clusters)</option>
                {project.clusters.map((c) => <option key={c.id} value={c.id}>{c.name} · {n(c.count)}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-[#9E9E9E]">Campaign dates must fall within the project window{project.endDate ? ` (${project.startDate} → ${project.endDate})` : ""}. To run past the project end, extend the project first.</div>
          <div className="mt-3 flex items-center justify-between rounded-[10px] bg-[#F5F7F5] px-4 py-3">
            <div className="text-[12px] text-[#616161]">Audience {clusterId ? "(cluster)" : "(project, de-duplicated)"} · before cross-campaign de-dup</div>
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
            <button type="button" onClick={() => openMembers(c)} className="rounded-[8px] bg-[#F5F7F5] px-3 py-1.5 text-[12px] font-semibold text-[#1565C0] hover:bg-[#E3F2FD]">{canManage ? "Farmers" : "Contact"}</button>
            {canManage && <button type="button" onClick={() => openTracker(c)} className="rounded-[8px] bg-[#F5F7F5] px-3 py-1.5 text-[12px] font-semibold text-[#2E7D32] hover:bg-[#E8F5E9]">Campaign Tracker</button>}
            {canManage && <button type="button" onClick={() => setExtendOf(c)} className="rounded-[8px] bg-[#F5F7F5] px-3 py-1.5 text-[12px] font-semibold text-[#6A1B9A] hover:bg-[#F3E5F5]">Extend</button>}
          </div>
        ))}
      </div>

      {/* Scoped contact list — outreach (TEST group): list view + one-at-a-time Focus mode */}
      <Modal open={membersOf != null} onClose={() => setMembersOf(null)} className="max-w-[1040px]">
        {membersOf && (
          <>
            <ModalHeader eyebrow="Campaign · outreach" eyebrowColor="#1565C0" title={membersOf.name}
              subtitle={canManage ? "Contact list (test group)" : "Your farmers — call, then log how you reached them"} onClose={() => setMembersOf(null)} />
            <div className="max-h-[74vh] overflow-y-auto px-5 py-4">
              {members == null ? <div className="py-8 text-center text-[13px] text-[#9E9E9E]">Loading…</div>
                : members.length === 0 ? <div className="py-8 text-center text-[13px] text-[#9E9E9E]">No farmers to contact here.</div>
                : (
                  <>
                    <OutreachProgress members={members} />
                    <div className="mb-3 mt-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[12px] text-[#757575]">{focusMode ? "Focus mode — one farmer at a time" : "Work the list, switch to Focus mode, or open the full-page matrix."}</div>
                      <div className="flex gap-2">
                        <Link href={`/campaigns/${membersOf.id}/outreach`}
                          className="rounded-[10px] bg-[#6A1B9A] px-4 py-2 text-[12.5px] font-bold text-white">⛶ Matrix view</Link>
                        <button type="button" onClick={() => setFocusMode((v) => !v)}
                          className="rounded-[10px] px-4 py-2 text-[12.5px] font-bold text-white" style={{ background: focusMode ? "#616161" : "#1565C0" }}>
                          {focusMode ? "← Back to list" : "▶ Focus mode"}
                        </button>
                      </div>
                    </div>
                    {focusMode
                      ? <FocusMode members={members} onChange={patchMember} onExit={() => setFocusMode(false)} />
                      : (() => {
                          // List view: un-contacted first, reached/unreachable sink to the bottom.
                          const sorted = [...members].sort((a, b) => rank(a) - rank(b));
                          const PAGE = 25;
                          const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
                          const page = Math.min(memberPage, pages - 1);
                          const slice = sorted.slice(page * PAGE, page * PAGE + PAGE);
                          return (
                            <>
                              <div className="flex flex-col gap-2.5">
                                {slice.map((m) => <MemberRow key={m.id} member={m} onChange={patchMember} />)}
                              </div>
                              {pages > 1 && (
                                <div className="mt-3 flex items-center justify-center gap-3">
                                  <button type="button" onClick={() => setMemberPage(Math.max(0, page - 1))} disabled={page === 0}
                                    className="rounded-[8px] border border-[#E0E0E0] px-3 py-1.5 text-[12px] font-semibold text-[#616161] disabled:opacity-40">← Prev</button>
                                  <span className="text-[12px] text-[#757575]">{page * PAGE + 1}–{Math.min((page + 1) * PAGE, sorted.length)} of {n(sorted.length)}</span>
                                  <button type="button" onClick={() => setMemberPage(Math.min(pages - 1, page + 1))} disabled={page >= pages - 1}
                                    className="rounded-[8px] border border-[#E0E0E0] px-3 py-1.5 text-[12px] font-semibold text-[#616161] disabled:opacity-40">Next →</button>
                                </div>
                              )}
                            </>
                          );
                        })()}
                  </>
                )}
            </div>
          </>
        )}
      </Modal>

      {/* Campaign Tracker (managers only) */}
      <Modal open={trackerOf != null} onClose={() => setTrackerOf(null)} className="max-w-[840px]">
        {trackerOf && (
          <>
            <ModalHeader eyebrow="Campaign Tracker" eyebrowColor="#2E7D32" title={trackerOf.name} subtitle="Outreach reach · real attributed revenue · test vs control uplift" onClose={() => setTrackerOf(null)} />
            <div className="max-h-[72vh] overflow-y-auto px-5 py-4">
              {tracker == null ? <div className="py-8 text-center text-[13px] text-[#9E9E9E]">Loading…</div> : <TrackerBody t={tracker} />}
            </div>
          </>
        )}
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

/* ── Outreach: approach tiles, status, phone, progress, list row + Focus mode ──
   (exported pieces are shared with the full-page Matrix view, OutreachMatrix.tsx) */
export const APPROACH_TILES: { key: string; label: string; color: string; bg: string }[] = [
  { key: "CALL", label: "Call", color: "#1565C0", bg: "#E3F2FD" },
  { key: "WHATSAPP", label: "WhatsApp", color: "#1B5E20", bg: "#E8F5E9" },
  { key: "SMS", label: "SMS", color: "#6A1B9A", bg: "#F3E5F5" },
  { key: "IN_PERSON", label: "In-person", color: "#E65100", bg: "#FFF3E0" },
];
export const UNREACHABLE_TILE = { color: "#C62828", bg: "#FDECEA" };
const APPROACH_KEYS = APPROACH_TILES.map((t) => t.key);
export function isApproach(med: string | null): boolean { return med != null && APPROACH_KEYS.includes(med); }
export function mediumLabel(k: string): string { return APPROACH_TILES.find((t) => t.key === k)?.label ?? k; }
export function statusOf(m: CampaignMemberVM): "reached" | "unreachable" | "pending" {
  if (m.reached) return "reached";
  if (m.medium === "UNREACHABLE") return "unreachable";
  return "pending";
}
/** Sort order for the list — un-contacted first, unreachable next, reached last. */
export function rank(m: CampaignMemberVM): number { const s = statusOf(m); return s === "pending" ? 0 : s === "unreachable" ? 1 : 2; }
/** Normalise an Indian mobile to its last 10 digits for tel:/wa.me links (null if not a usable number). */
export function digits10(mobile: string | null): string | null {
  if (!mobile) return null;
  const d = mobile.replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

export function StatusBadge({ member }: { member: CampaignMemberVM }) {
  const s = statusOf(member);
  const who = member.reachedBy ? ` · by ${member.reachedBy}` : "";
  const audit = member.reachedBy ? `Recorded by ${member.reachedBy}${member.reachedByCode ? ` (${member.reachedByCode})` : ""}${member.reachedAt ? ` on ${member.reachedAt}` : ""}` : undefined;
  if (s === "reached")
    return <span title={audit} className="rounded-full bg-[#E8F5E9] px-2.5 py-0.5 text-[10px] font-semibold text-[#2E7D32]">✓ Reached{member.medium && member.medium !== "UNREACHABLE" ? ` · ${mediumLabel(member.medium)}` : ""}{member.reachedAt ? ` · ${member.reachedAt}` : ""}{who}</span>;
  if (s === "unreachable")
    return <span title={audit} className="rounded-full bg-[#FDECEA] px-2.5 py-0.5 text-[10px] font-semibold text-[#C62828]">Unreachable{member.reachedAt ? ` · ${member.reachedAt}` : ""}{who}</span>;
  return null;
}

/** Prominent, tappable phone number — what officers dial from. */
function PhoneBlock({ mobile, big }: { mobile: string | null; big?: boolean }) {
  const d10 = digits10(mobile);
  if (!d10) return <div className="rounded-[12px] bg-[#FFF8E1] px-4 py-3 text-[13px] font-semibold text-[#8D6E00]">No phone number on file</div>;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[12px] bg-[#F5F8FF] px-4 py-3">
      <a href={`tel:+91${d10}`} className={`flex items-center gap-2 font-bold leading-none tracking-wide text-[#0D47A1] hover:underline ${big ? "text-[32px]" : "text-[24px]"}`}>
        <span className={big ? "text-[24px]" : "text-[18px]"}>📞</span>{mobile}
      </a>
      <div className="ml-auto flex gap-2">
        <a href={`tel:+91${d10}`} className={`rounded-[10px] bg-[#1565C0] font-bold text-white ${big ? "px-5 py-3 text-[14px]" : "px-4 py-2.5 text-[13px]"}`}>Call</a>
        <a href={`https://wa.me/91${d10}`} target="_blank" rel="noopener noreferrer" className={`rounded-[10px] bg-[#1B8A4B] font-bold text-white ${big ? "px-5 py-3 text-[14px]" : "px-4 py-2.5 text-[13px]"}`}>WhatsApp</a>
      </div>
    </div>
  );
}

/** Approach tiles (Call/WhatsApp/SMS/In-person) + a right-aligned Unreachable tile. */
function ApproachPicker({ value, onSelect, disabled }: { value: string | null; onSelect: (v: string | null) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-semibold uppercase text-[#757575]">How did you reach them?</span>
      {APPROACH_TILES.map((t) => { const on = value === t.key; return (
        <button key={t.key} type="button" disabled={disabled} onClick={() => onSelect(on ? null : t.key)}
          className="rounded-full border-[1.5px] px-3.5 py-1.5 text-[12.5px] font-semibold disabled:opacity-50"
          style={{ background: on ? t.bg : "#fff", color: on ? t.color : "#616161", borderColor: on ? t.color : "#DADADA" }}>{t.label}</button>
      ); })}
      <button type="button" disabled={disabled} onClick={() => onSelect(value === "UNREACHABLE" ? null : "UNREACHABLE")}
        className="ml-auto rounded-full border-[1.5px] px-3.5 py-1.5 text-[12.5px] font-semibold disabled:opacity-50"
        style={{ background: value === "UNREACHABLE" ? UNREACHABLE_TILE.bg : "#fff", color: value === "UNREACHABLE" ? UNREACHABLE_TILE.color : "#9E9E9E", borderColor: value === "UNREACHABLE" ? UNREACHABLE_TILE.color : "#E0E0E0" }}>
        Unreachable
      </button>
    </div>
  );
}

/** Reached (green) + unreachable (red) progress bar over the whole list. */
export function OutreachProgress({ members }: { members: CampaignMemberVM[] }) {
  const total = members.length;
  const reached = members.filter((m) => m.reached).length;
  const unreachable = members.filter((m) => statusOf(m) === "unreachable").length;
  const left = total - reached - unreachable;
  const pct = (x: number) => (total ? (x / total) * 100 : 0);
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
        <span className="font-semibold text-[#1A1C1A]">{n(total)} to contact</span>
        <span className="text-[#616161]"><b className="text-[#2E7D32]">{n(reached)} reached</b>{unreachable ? <> · <b className="text-[#C62828]">{n(unreachable)} unreachable</b></> : null} · {n(left)} left</span>
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-[#EDEDED]">
        <div style={{ width: `${pct(reached)}%`, background: "#2E7D32" }} />
        <div style={{ width: `${pct(unreachable)}%`, background: "#C62828" }} />
      </div>
    </div>
  );
}

function MemberRow({ member, onChange }: { member: CampaignMemberVM; onChange: (m: CampaignMemberVM) => void }) {
  const [medium, setMedium] = useState<string | null>(member.medium);
  const [comment, setComment] = useState(member.comment ?? "");
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = medium !== member.medium || comment !== (member.comment ?? "");
  const st = statusOf(member);

  const save = () => {
    setErr(null); setSaved(false);
    start(async () => {
      const res = await markCampaignMember(member.id, { medium, comment });
      if (res.ok) { onChange({ ...member, reached: isApproach(medium), medium, comment: comment.trim() || null }); setSaved(true); }
      else setErr(res.error ?? "Failed");
    });
  };

  return (
    <div className="rounded-[16px] border p-4" style={{ borderColor: st === "reached" ? "#81C784" : st === "unreachable" ? "#EF9A9A" : "#E8E8E8", background: st === "reached" ? "#F6FFF4" : st === "unreachable" ? "#FEF6F5" : "#fff" }}>
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <span className="text-[16px] font-bold text-[#1A1C1A]">{member.name}</span>
        <span className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold" style={{ background: segMeta(member.segment).bg, color: segMeta(member.segment).color }}>{segMeta(member.segment).label}</span>
        <StatusBadge member={member} />
        <span className="text-[12px] text-[#9E9E9E]">{member.village ?? "—"}{member.store ? ` · ${member.store}` : ""}</span>
      </div>
      <div className="mb-3"><PhoneBlock mobile={member.mobile} /></div>
      <div className="rounded-[12px] border border-[#EAEAEA] bg-[#FBFBFB] p-3">
        <ApproachPicker value={medium} onSelect={(v) => { setMedium(v); setSaved(false); }} disabled={pending} />
        <textarea value={comment} onChange={(e) => { setComment(e.target.value); setSaved(false); }} placeholder="Add a note (optional)…"
          rows={2} className="mt-2 w-full resize-y rounded-lg border border-[#E0E0E0] px-3 py-2 text-[13px]" />
        <div className="mt-2 flex items-center gap-2">
          <button type="button" onClick={save} disabled={pending || !dirty}
            className="rounded-[10px] bg-[#2E7D32] px-5 py-2 text-[13px] font-bold text-white disabled:opacity-40">
            {pending ? "Saving…" : saved && !dirty ? "Saved ✓" : medium === "UNREACHABLE" ? "Save — mark unreachable" : medium ? "Save — mark reached" : "Save"}
          </button>
          {err && <span className="text-[12px] font-semibold text-[#C62828]">{err}</span>}
        </div>
      </div>
    </div>
  );
}

/* ── Focus mode: one farmer at a time (queue: head = current; skip requeues; back re-opens last) ── */
function FocusMode({ members, onChange, onExit }: { members: CampaignMemberVM[]; onChange: (m: CampaignMemberVM) => void; onExit: () => void }) {
  const [queue, setQueue] = useState<number[]>(() => members.filter((m) => statusOf(m) === "pending").map((m) => m.id));
  const [history, setHistory] = useState<number[]>([]);
  const currentId = queue[0];
  const member = members.find((m) => m.id === currentId) ?? null;

  const handled = () => { setHistory((h) => [...h, currentId]); setQueue((q) => q.slice(1)); };
  const skip = () => setQueue((q) => (q.length > 1 ? [...q.slice(1), q[0]] : q));
  const back = () => { if (!history.length) return; const id = history[history.length - 1]; setHistory((h) => h.slice(0, -1)); setQueue((q) => [id, ...q.filter((x) => x !== id)]); };

  return (
    <div className="mt-3">
      {member
        ? <FocusCard key={member.id} member={member} onChange={onChange} onHandled={handled} onSkip={skip} onBack={history.length ? back : undefined} remaining={queue.length} />
        : (
          <div className="rounded-[18px] border-2 border-[#A5D6A7] bg-[#F6FFF4] p-10 text-center">
            <div className="text-[20px] font-bold text-[#1B5E20]">All done 🎉</div>
            <div className="mt-1.5 text-[13px] text-[#616161]">You've worked through everyone in this list. Skipped farmers loop back until they're handled.</div>
            <button type="button" onClick={onExit} className="mt-4 rounded-[10px] bg-[#2E7D32] px-6 py-2.5 text-[13px] font-bold text-white">Back to list</button>
          </div>
        )}
    </div>
  );
}

function FocusCard({ member, onChange, onHandled, onSkip, onBack, remaining }: {
  member: CampaignMemberVM; onChange: (m: CampaignMemberVM) => void; onHandled: () => void; onSkip: () => void; onBack?: () => void; remaining: number;
}) {
  const [medium, setMedium] = useState<string | null>(member.medium);
  const [comment, setComment] = useState(member.comment ?? "");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const commit = () => {
    if (!medium) return; // pick an approach or Unreachable, else Skip
    setErr(null);
    start(async () => {
      const res = await markCampaignMember(member.id, { medium, comment });
      if (res.ok) { onChange({ ...member, reached: isApproach(medium), medium, comment: comment.trim() || null }); onHandled(); }
      else setErr(res.error ?? "Failed");
    });
  };

  return (
    <div className="rounded-[18px] border-2 border-[#E3EAF5] bg-white p-5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[22px] font-bold text-[#1A1C1A]">{member.name}</span>
        <span className="rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold" style={{ background: segMeta(member.segment).bg, color: segMeta(member.segment).color }}>{segMeta(member.segment).label}</span>
        <StatusBadge member={member} />
        <span className="ml-auto rounded-full bg-[#F5F7F5] px-2.5 py-0.5 text-[11.5px] font-semibold text-[#616161]">{remaining} left</span>
      </div>
      <div className="mb-3 text-[12.5px] text-[#9E9E9E]">{member.village ?? "—"}{member.store ? ` · ${member.store}` : ""}</div>
      <div className="mb-4"><PhoneBlock mobile={member.mobile} big /></div>
      <div className="rounded-[12px] border border-[#EAEAEA] bg-[#FBFBFB] p-3.5">
        <ApproachPicker value={medium} onSelect={setMedium} disabled={pending} />
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a note (optional)…"
          rows={2} className="mt-2.5 w-full resize-y rounded-lg border border-[#E0E0E0] px-3 py-2 text-[13px]" />
      </div>
      {err && <div className="mt-2 text-[12px] font-semibold text-[#C62828]">{err}</div>}
      <div className="mt-4 flex items-center gap-2">
        {onBack && <button type="button" onClick={onBack} disabled={pending} className="rounded-[10px] border border-[#E0E0E0] px-4 py-2.5 text-[13px] font-semibold text-[#616161] disabled:opacity-40">← Back</button>}
        <button type="button" onClick={onSkip} disabled={pending} className="rounded-[10px] border border-[#E0E0E0] px-4 py-2.5 text-[13px] font-semibold text-[#616161] disabled:opacity-40">Skip →</button>
        <button type="button" onClick={commit} disabled={pending || !medium}
          className="ml-auto rounded-[10px] px-6 py-2.5 text-[13.5px] font-bold text-white disabled:opacity-40"
          style={{ background: medium === "UNREACHABLE" ? "#C62828" : "#2E7D32" }}>
          {pending ? "Saving…" : medium === "UNREACHABLE" ? "Mark unreachable & next" : "Save & next"}
        </button>
      </div>
      {!medium && <div className="mt-2 text-right text-[11.5px] text-[#9E9E9E]">Pick how you reached them (or Unreachable), or Skip to come back later.</div>}
    </div>
  );
}

/* ── Campaign Tracker body: reach + real attributed revenue + uplift ── */
function Kpi({ label, value, color }: { label: string; value: string; color?: string }) {
  return <div className="rounded-[10px] bg-[#F5F7F5] px-3 py-2.5"><div className="text-[17px] font-bold" style={{ color: color ?? "#1A1C1A" }}>{value}</div><div className="text-[10.5px] text-[#757575]">{label}</div></div>;
}

function TrackerBody({ t }: { t: CampaignTracker }) {
  const a = t.attribution;
  const reachPct = t.reach.testTotal > 0 ? Math.round((t.reach.reached / t.reach.testTotal) * 100) : 0;
  return (
    <div className="flex flex-col gap-4">
      <div className={`${CARD} p-4`}>
        <div className="mb-2 text-[13px] font-bold text-[#1A1C1A]">Outreach</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Test farmers" value={n(t.reach.testTotal)} />
          <Kpi label={`Reached (${reachPct}%)`} value={n(t.reach.reached)} color="#2E7D32" />
          <Kpi label="Call·WA·SMS·Visit" value={`${n(t.reach.byApproach.CALL)}·${n(t.reach.byApproach.WHATSAPP)}·${n(t.reach.byApproach.SMS)}·${n(t.reach.byApproach.IN_PERSON)}`} />
          <Kpi label="Paying (contacted)" value={n(a.payingFarmers)} color="#1565C0" />
        </div>
      </div>

      <div className={`${CARD} p-4`}>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[13px] font-bold text-[#1A1C1A]">Attributed revenue</div>
          <div className="text-[11px] text-[#9E9E9E]">{a.windowStart} → {a.windowEnd}</div>
        </div>
        <div className="mb-2 text-[11.5px] text-[#616161]">Counts purchases by <b>contacted</b> farmers · matched on — <b>{a.basisLabel}</b></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-[10px] bg-[#E8F5E9] px-4 py-3"><div className="text-[20px] font-bold text-[#1B5E20]">{inr(a.matchedRevenue)}</div><div className="text-[11px] text-[#2E7D32]">Campaign-matched revenue</div></div>
          <div className="rounded-[10px] bg-[#F5F7F5] px-4 py-3"><div className="text-[20px] font-bold text-[#1A1C1A]">{inr(a.totalRevenue)}</div><div className="text-[11px] text-[#9E9E9E]">All purchases by contacted farmers</div></div>
        </div>
        {a.noCatalogMatch && (
          <div className="mt-2 rounded-[10px] border border-[#FFE0B2] bg-[#FFF8E1] px-3 py-2 text-[11.5px] text-[#8D6E00]">
            No sales data carries this cluster's crop, so crop-matched revenue reads ₹0 — use the "all purchases" figure for context, or target by product category for precise attribution.
          </div>
        )}
      </div>

      <div className={`${CARD} p-4`}>
        <div className="mb-2 text-[13px] font-bold text-[#1A1C1A]">Test vs control uplift</div>
        {t.uplift.length === 0 ? <div className="py-4 text-center text-[12.5px] text-[#9E9E9E]">No members / no matched sales yet. Uplift matures as monthly sales are imported.</div>
          : (
            <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-[12px]">
              <thead><tr className="border-b border-[#EEE] text-[10px] font-bold uppercase text-[#9E9E9E]">
                <th className="py-2">Segment</th><th className="text-right">Test</th><th className="text-right">Reached</th><th className="text-right">Test %buy</th><th className="text-right">Ctrl %buy</th><th className="text-right">Uplift</th><th className="text-right">Incremental ₹</th>
              </tr></thead>
              <tbody>{t.uplift.map((u) => { const testPct = u.test.reached > 0 ? (u.test.purchased / u.test.reached) : (u.test.farmers ? u.test.purchased / u.test.farmers : 0); const ctrlPct = u.control.farmers ? u.control.purchased / u.control.farmers : 0; return (
                <tr key={u.segment} className="border-b border-[#F5F5F5]">
                  <td className="py-2 font-semibold" style={{ color: segMeta(u.segment).color }}>{segMeta(u.segment).label}</td>
                  <td className="text-right">{n(u.test.farmers)}</td>
                  <td className="text-right">{n(u.test.reached)}</td>
                  <td className="text-right">{(testPct * 100).toFixed(0)}%</td>
                  <td className="text-right">{(ctrlPct * 100).toFixed(0)}%</td>
                  <td className="text-right font-semibold" style={{ color: u.upliftPurchasePct >= 0 ? "#2E7D32" : "#C62828" }}>{u.upliftPurchasePct > 0 ? "+" : ""}{u.upliftPurchasePct}pp</td>
                  <td className="text-right font-bold text-[#1A1C1A]">{inr(u.incremental)}</td>
                </tr>
              ); })}</tbody>
            </table></div>
          )}
      </div>
    </div>
  );
}

/* ══════════════════ Shell ══════════════════ */
export function CampaignsScreen({ templates, campaigns, stores: _stores, projects, canManage, initialProjectId }: {
  templates: CommTemplateVM[]; campaigns: CampaignListItem[]; stores: StoreLite[]; projects: ProjectVM[]; canManage: boolean; initialProjectId?: number;
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
      {tab === "campaigns" && <CampaignsTab campaigns={campaigns} projects={projects} canManage={canManage} initialProjectId={initialProjectId} />}
    </div>
  );
}
