"use client";

import { useMemo, useState, useTransition } from "react";
import { Modal, ModalHeader } from "@/components/interactive";
import {
  listProjects, createProject, setProjectClusters, deleteProject,
  type ProjectVM, type ClusterVM,
} from "@/app/actions/campaigns";

const CARD = "rounded-[14px] border border-black/[0.04] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]";
const n = (x: number) => x.toLocaleString("en-IN");
const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  PLANNED: { bg: "#EEF3FB", color: "#1565C0" },
  ACTIVE: { bg: "#E8F5E9", color: "#2E7D32" },
  COMPLETED: { bg: "#F5F5F5", color: "#616161" },
};

export function ProjectsTab({ initial, clusters }: { initial: ProjectVM[]; clusters: ClusterVM[] }) {
  const [list, setList] = useState(initial);
  const [building, setBuilding] = useState(false);
  const [editing, setEditing] = useState<ProjectVM | null>(null);
  const [pending, start] = useTransition();

  const refresh = () => start(async () => setList(await listProjects()));
  const remove = (id: number) =>
    start(async () => { await deleteProject(id); setList((l) => l.filter((p) => p.id !== id)); });

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[13px] text-[#757575]">
          A project bundles one or more clusters. Run a campaign on the whole project, or on a single cluster inside it.
        </div>
        <button type="button" onClick={() => setBuilding(true)} disabled={clusters.length === 0}
          className="rounded-[10px] bg-[#2E7D32] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50">+ New project</button>
      </div>

      {clusters.length === 0 && (
        <div className="mb-3 rounded-[10px] border border-[#FFE0B2] bg-[#FFF8E1] px-3.5 py-2.5 text-[12.5px] text-[#8D6E00]">
          Build at least one cluster first (Clusters tab) — projects are made from clusters.
        </div>
      )}

      <div className={`${CARD} overflow-hidden`}>
        {list.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-[#9E9E9E]">No projects yet — bundle a few clusters into one.</div>
        ) : list.map((p) => {
          const st = STATUS_STYLE[p.status] ?? STATUS_STYLE.PLANNED;
          return (
            <div key={p.id} className="border-b border-[#F5F5F5] px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px] font-bold text-[#1A1C1A]">{p.name}</span>
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: st.bg, color: st.color }}>{p.status}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {p.clusters.length === 0 ? (
                      <span className="text-[11.5px] text-[#C62828]">No clusters</span>
                    ) : p.clusters.map((c) => (
                      <span key={c.id} className="rounded-full bg-[#F5F7F5] px-2 py-0.5 text-[10.5px] font-medium text-[#616161]">
                        {c.name} · {n(c.count)}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[13px] font-bold text-[#2E7D32]">{n(p.audienceCount)}</div>
                  <div className="text-[10.5px] text-[#9E9E9E]">unique farmers</div>
                </div>
                <button type="button" onClick={() => setEditing(p)} className="rounded-[8px] bg-[#F5F7F5] px-3 py-1.5 text-[12px] font-semibold text-[#2E7D32] hover:bg-[#E8F5E9]">Edit</button>
                <button type="button" onClick={() => remove(p.id)} disabled={pending} className="rounded-[8px] bg-[#FDECEA] px-3 py-1.5 text-[12px] font-semibold text-[#C62828] hover:bg-[#F9DCD8] disabled:opacity-50">Delete</button>
              </div>
            </div>
          );
        })}
      </div>

      {building && (
        <ProjectBuilder
          clusters={clusters}
          onClose={() => setBuilding(false)}
          onSaved={() => { setBuilding(false); refresh(); }}
        />
      )}
      {editing && (
        <ProjectBuilder
          clusters={clusters}
          project={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}

/* ── Create / edit ── */
function ProjectBuilder({ clusters, project, onClose, onSaved }: {
  clusters: ClusterVM[]; project?: ProjectVM; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [picked, setPicked] = useState<number[]>(project?.clusters.map((c) => c.id) ?? []);
  const [saving, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const reach = useMemo(
    () => clusters.filter((c) => picked.includes(c.id)).reduce((s, c) => s + c.count, 0),
    [picked, clusters],
  );

  const save = () => {
    setErr(null);
    start(async () => {
      const res = project
        ? await setProjectClusters(project.id, picked)
        : await createProject(name, picked);
      if (res.ok) onSaved();
      else setErr(res.error ?? "Failed");
    });
  };

  return (
    <Modal open onClose={onClose} className="max-w-[560px]">
      <ModalHeader
        eyebrow="Step 2 · Project"
        eyebrowColor="#2E7D32"
        title={project ? "Edit project" : "New project"}
        subtitle="Bundle reusable clusters — audience is their live union"
        onClose={onClose}
      />
      <div className="max-h-[68vh] overflow-y-auto px-5 py-4">
        {!project && (
          <>
            <label className="text-[11px] font-semibold uppercase text-[#9E9E9E]">Name</label>
            <input className="mt-1 mb-3 w-full rounded-lg border border-[#E0E0E0] px-3 py-2 text-[13px]" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kharif Maize Push" />
          </>
        )}

        <div className="mb-1.5 text-[11px] font-semibold uppercase text-[#9E9E9E]">Clusters</div>
        <div className="flex flex-col gap-1.5">
          {clusters.map((c) => {
            const on = picked.includes(c.id);
            return (
              <button key={c.id} type="button" onClick={() => toggle(c.id)}
                className="flex items-center justify-between rounded-[10px] border-[1.5px] px-3 py-2 text-left transition-colors"
                style={{ background: on ? "#E8F5E9" : "#fff", borderColor: on ? "#2E7D32" : "#E0E0E0" }}>
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-semibold" style={{ color: on ? "#1B5E20" : "#1A1C1A" }}>{c.name}</div>
                  <div className="truncate text-[11px] text-[#9E9E9E]" title={c.description}>{c.description}</div>
                </div>
                <div className="ml-3 shrink-0 text-[12px] font-bold" style={{ color: on ? "#2E7D32" : "#9E9E9E" }}>{n(c.count)}</div>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-between rounded-[10px] bg-[#F5F7F5] px-4 py-3">
          <div className="text-[12px] text-[#616161]">{picked.length} cluster{picked.length === 1 ? "" : "s"} · summed reach</div>
          <div className="text-[18px] font-bold text-[#2E7D32]">{n(reach)}</div>
        </div>
        <div className="mt-1 text-[11px] text-[#9E9E9E]">Actual project audience de-duplicates farmers shared across clusters.</div>
        {err && <div className="mt-2 text-[12px] text-[#C62828]">{err}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-[10px] border border-[#E0E0E0] px-4 py-2 text-[13px] font-semibold text-[#616161]">Cancel</button>
          <button type="button" onClick={save} disabled={saving || (!project && !name.trim()) || picked.length === 0}
            className="rounded-[10px] bg-[#2E7D32] px-5 py-2 text-[13px] font-semibold text-white disabled:opacity-50">
            {saving ? "Saving…" : project ? "Save changes" : "Create project"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
