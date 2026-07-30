"use client";

import { useMemo, useState, useTransition } from "react";
import { Modal, ModalHeader } from "@/components/interactive";
import { updateBugStatus, getBugScreenshot, deleteBug } from "@/app/actions/bugs";
import { BUG_SEVERITIES, type BugVM } from "@/lib/bug-constants";

const COLUMNS: { key: string; label: string; color: string; hint: string }[] = [
  { key: "OPEN", label: "Open", color: "#1565C0", hint: "Not yet started" },
  { key: "IN_PROGRESS", label: "In Progress", color: "#E65100", hint: "Being worked on" },
  { key: "TESTING", label: "Testing", color: "#7B1FA2", hint: "Verifying the fix" },
  { key: "FIXED", label: "Fixed", color: "#2E7D32", hint: "Resolved" },
  { key: "CLOSED", label: "Closed", color: "#616161", hint: "Done & archived" },
];
const SEV: Record<string, { bg: string; c: string }> = {
  LOW: { bg: "#E8F5E9", c: "#2E7D32" }, MEDIUM: { bg: "#FFF8E1", c: "#F9A825" },
  HIGH: { bg: "#FFF3E0", c: "#E65100" }, CRITICAL: { bg: "#FDECEA", c: "#C62828" },
};
const SEV_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function Kpi({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="rounded-[14px] border border-black/[0.03] bg-white px-5 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.5px] text-[#9E9E9E]">{label}</div>
      <div className="mt-1 text-[26px] font-bold leading-none" style={{ color: color ?? "#1A1C1A" }}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-[#9E9E9E]">{sub}</div>}
    </div>
  );
}

export function BugTracker({ bugs: initial }: { bugs: BugVM[] }) {
  const [bugs, setBugs] = useState(initial);
  const [sev, setSev] = useState("");
  const [q, setQ] = useState("");
  const [dragId, setDragId] = useState<number | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [shot, setShot] = useState<{ id: number; title: string; url: string | null } | null>(null);
  const [, start] = useTransition();

  const kpis = useMemo(() => {
    const by = (fn: (b: BugVM) => boolean) => bugs.filter(fn).length;
    const resolved = bugs.filter((b) => b.resolvedAt);
    const avgMs = resolved.length
      ? resolved.reduce((s, b) => s + (new Date(b.resolvedAt!).getTime() - new Date(b.createdAt).getTime()), 0) / resolved.length
      : 0;
    const avgDays = avgMs ? avgMs / 86_400_000 : 0;
    return {
      total: bugs.length,
      open: by((b) => b.status === "OPEN"),
      inProgress: by((b) => b.status === "IN_PROGRESS" || b.status === "TESTING"),
      fixed: by((b) => b.status === "FIXED" || b.status === "CLOSED"),
      turnaround: resolved.length ? (avgDays < 1 ? `${Math.round(avgDays * 24)}h` : `${avgDays.toFixed(1)}d`) : "—",
    };
  }, [bugs]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return bugs.filter((b) =>
      (!sev || b.severity === sev) &&
      (!t || `${b.title} ${b.reporter} ${b.page}`.toLowerCase().includes(t)));
  }, [bugs, sev, q]);

  const move = (id: number, status: string) => {
    const bug = bugs.find((b) => b.id === id);
    if (!bug || bug.status === status) return;
    const prev = bugs;
    const resolved = status === "FIXED" || status === "CLOSED";
    setBugs((bs) => bs.map((b) => b.id === id ? { ...b, status, resolvedAt: resolved ? (b.resolvedAt ?? new Date().toISOString()) : null } : b));
    start(async () => {
      const res = await updateBugStatus(id, status);
      if (!res.ok) { setBugs(prev); alert(res.error ?? "Update failed."); }
    });
  };

  const remove = (id: number) => {
    if (!confirm("Delete this bug report?")) return;
    const prev = bugs;
    setBugs((bs) => bs.filter((b) => b.id !== id));
    start(async () => { const r = await deleteBug(id); if (!r.ok) setBugs(prev); });
  };

  const viewShot = (b: BugVM) => {
    setShot({ id: b.id, title: b.title, url: null });
    getBugScreenshot(b.id).then((url) => setShot((s) => (s && s.id === b.id ? { ...s, url } : s)));
  };

  return (
    <div className="animate-[fadeUp_0.4s_ease-out]">
      {/* KPI strip */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Total Bugs" value={kpis.total} />
        <Kpi label="Open" value={kpis.open} sub="Not yet fixed" color="#1565C0" />
        <Kpi label="In Progress" value={kpis.inProgress} sub="Working + testing" color="#E65100" />
        <Kpi label="Fixed" value={kpis.fixed} sub="Resolved & closed" color="#2E7D32" />
        <Kpi label="Avg Turnaround" value={kpis.turnaround} sub="Reported → fixed" />
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.4px] text-[#9E9E9E]">Filter</span>
        <select value={sev} onChange={(e) => setSev(e.target.value)}
          className="rounded-[10px] border border-[#E0E0E0] bg-white px-3 py-[7px] text-[12.5px] text-[#424242] outline-none focus:border-[#2E7D32]">
          <option value="">Severity</option>
          {BUG_SEVERITIES.map((s) => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title / reporter…"
          className="min-w-[220px] rounded-[10px] border border-[#E0E0E0] bg-white px-3.5 py-[7px] text-[12.5px] outline-none focus:border-[#2E7D32]" />
      </div>

      {bugs.length === 0 ? (
        <div className="rounded-[14px] border border-black/[0.03] bg-white px-6 py-16 text-center shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="text-[34px]">🐞</div>
          <div className="mt-2 text-[15px] font-bold text-[#1A1C1A]">No bugs reported yet</div>
          <div className="mt-1 text-[12.5px] text-[#9E9E9E]">Users can file bugs from the “Report a Bug” button in the top bar.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {COLUMNS.map((col) => {
            const items = shown.filter((b) => b.status === col.key).sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));
            return (
              <div key={col.key}
                onDragOver={(e) => { e.preventDefault(); setOverCol(col.key); }}
                onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
                onDrop={(e) => { e.preventDefault(); const id = Number(e.dataTransfer.getData("text/plain")); if (id) move(id, col.key); setOverCol(null); setDragId(null); }}
                className={`rounded-[14px] border p-2 transition-colors ${overCol === col.key ? "border-[#2E7D32] bg-[#F1F8F1]" : "border-[#EEE] bg-[#FAFAFA]"}`}
              >
                <div className="mb-2 flex items-center justify-between px-1.5 pt-1">
                  <span className="flex items-center gap-1.5 text-[12px] font-bold" style={{ color: col.color }}>
                    <span className="h-2 w-2 rounded-full" style={{ background: col.color }} />{col.label}
                  </span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-[#757575]">{items.length}</span>
                </div>
                <div className="flex min-h-[60px] flex-col gap-2">
                  {items.map((b) => (
                    <div key={b.id}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", String(b.id)); e.dataTransfer.effectAllowed = "move"; setDragId(b.id); }}
                      onDragEnd={() => { setDragId(null); setOverCol(null); }}
                      className={`cursor-grab rounded-[10px] border border-[#EFEFEF] bg-white p-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] active:cursor-grabbing ${dragId === b.id ? "opacity-50" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-[12.5px] font-semibold leading-snug text-[#1A1C1A]">{b.title}</div>
                        <span className="flex-none rounded-full px-1.5 py-0.5 text-[9px] font-bold" style={{ background: SEV[b.severity]?.bg ?? "#EEE", color: SEV[b.severity]?.c ?? "#616161" }}>
                          {b.severity[0] + b.severity.slice(1).toLowerCase()}
                        </span>
                      </div>
                      {b.description && <div className="mt-1 line-clamp-2 text-[11px] text-[#757575]">{b.description}</div>}
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-[#9E9E9E]">
                        <span>{b.reporter}</span><span>·</span><span>{ago(b.createdAt)}</span>
                        {b.page && <><span>·</span><span className="truncate max-w-[120px]" title={b.page}>{b.page}</span></>}
                      </div>
                      <div className="mt-2 flex items-center gap-1.5 border-t border-[#F5F5F5] pt-2">
                        <select value={b.status} onChange={(e) => move(b.id, e.target.value)}
                          className="flex-1 rounded-md border border-[#E8E8E8] bg-white px-1.5 py-1 text-[10.5px] text-[#616161] outline-none">
                          {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                        </select>
                        {b.hasScreenshot && (
                          <button type="button" onClick={() => viewShot(b)} title="View screenshot"
                            className="rounded-md bg-[#F5F7F5] px-1.5 py-1 text-[10.5px] font-semibold text-[#1565C0] hover:bg-[#E3F2FD]">📷</button>
                        )}
                        <button type="button" onClick={() => remove(b.id)} title="Delete"
                          className="rounded-md bg-[#FDECEA] px-1.5 py-1 text-[10.5px] font-semibold text-[#C62828] hover:bg-[#F9DCD8]">✕</button>
                      </div>
                    </div>
                  ))}
                  {items.length === 0 && <div className="rounded-[10px] border border-dashed border-[#E5E5E5] py-4 text-center text-[11px] text-[#BDBDBD]">Drop here</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={shot != null} onClose={() => setShot(null)} className="max-w-[720px]">
        {shot && (
          <>
            <ModalHeader eyebrow="Screenshot" eyebrowColor="#1565C0" title={shot.title} onClose={() => setShot(null)} />
            <div className="px-5 py-4">
              {shot.url == null ? <div className="py-10 text-center text-[13px] text-[#9E9E9E]">Loading…</div>
                : /* eslint-disable-next-line @next/next/no-img-element */ <img src={shot.url} alt="bug screenshot" className="mx-auto max-h-[70vh] w-auto rounded-[10px] border border-[#EEE]" />}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
