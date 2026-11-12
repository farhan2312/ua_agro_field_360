"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { saveReport, type ReportFull } from "@/app/actions/custom-analytics";
import { DATASETS, DATASET_BY_ID, fieldMeta, aggsFor, valueLabel, type FieldMeta } from "@/lib/custom-analytics/model";
import { placeField, changeType, typeForField, normalize, type Well } from "@/lib/custom-analytics/placement";
import { VISUAL_META, AGG_LABEL, GRAIN_LABEL, emptyDoc, uid, type ReportDoc, type Visual, type VisualType, type CrossFilter, type FieldRef, type Agg, type DateGrain, type Layout } from "@/lib/custom-analytics/types";
import { useConfirm } from "@/components/ConfirmDialog";
import { GridCanvas, bottomRow } from "./GridCanvas";
import { PageFiltersBar } from "./PageFiltersBar";
import { visualTitle } from "./VisualCard";

const DRAG_MIME = "application/x-ca-field";
const KIND_ICON: Record<string, string> = { measure: "Σ", num: "#", dim: "Aa" };

/** Full-screen report builder: canvas + pages on the left, Visuals / Build / Data panel on the right. */
export function ReportBuilder({ initial }: { initial: ReportFull | null }) {
  const router = useRouter();
  const [id, setId] = useState<number | null>(initial?.id ?? null);
  const [title, setTitle] = useState(initial?.title ?? "Untitled report");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [doc, setDoc] = useState<ReportDoc>(initial?.doc ?? emptyDoc());
  const [pageIdx, setPageIdx] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cf, setCf] = useState<CrossFilter | null>(null);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set(["sales"]));
  const [renaming, setRenaming] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const { confirm, dialog } = useConfirm();

  const page = doc.pages[Math.min(pageIdx, doc.pages.length - 1)];
  const selected = page.visuals.find((v) => v.id === selectedId) ?? null;

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const flash = (ok: boolean, text: string) => { setMsg({ ok, text }); setTimeout(() => setMsg(null), ok ? 2200 : 5000); };
  const mutatePage = (fn: (p: ReportDoc["pages"][number]) => ReportDoc["pages"][number]) => {
    setDoc((d) => ({ ...d, pages: d.pages.map((p, i) => (i === Math.min(pageIdx, d.pages.length - 1) ? fn(p) : p)) }));
    setDirty(true);
  };
  const updateVisual = (vid: string, fn: (v: Visual) => Visual) => mutatePage((p) => ({ ...p, visuals: p.visuals.map((v) => (v.id === vid ? fn(v) : v)) }));
  const removeVisual = (vid: string) => { mutatePage((p) => ({ ...p, visuals: p.visuals.filter((v) => v.id !== vid) })); if (selectedId === vid) setSelectedId(null); if (cf?.sourceVisual === vid) setCf(null); };

  const newVisual = (type: VisualType, extra: Partial<Visual> = {}): Visual => {
    const size = VISUAL_META[type].defaultSize;
    return { id: uid(), type, dataset: null, values: [], axis: null, split: null, dims: type === "table" ? [] : undefined, layout: { x: 0, y: bottomRow(page.visuals), ...size }, ...extra };
  };
  const addVisual = (v: Visual) => { mutatePage((p) => ({ ...p, visuals: [...p.visuals, v] })); setSelectedId(v.id); };

  /** Click a visual type: change the selected visual, or add a new one. */
  const pickType = (type: VisualType) => {
    if (selected) updateVisual(selected.id, (v) => changeType(v, type));
    else addVisual(newVisual(type));
  };

  /** Click / drop a field. `target` = a visual id (or null → selected, or a new visual), `well` = chosen slot. */
  const applyField = (ds: string, fieldId: string, targetId?: string | null, well?: Well) => {
    const tid = targetId === undefined ? selectedId : targetId;
    const v = tid ? page.visuals.find((x) => x.id === tid) : null;
    if (!v) {
      const nv = newVisual(typeForField(ds, fieldId));
      const r = placeField(nv, ds, fieldId);
      if ("error" in r) flash(false, r.error); else addVisual(r.visual);
      return;
    }
    const r = placeField(v, ds, fieldId, well);
    if ("error" in r) flash(false, r.error);
    else { updateVisual(v.id, () => r.visual); setSelectedId(v.id); }
  };

  const onLayout = (layouts: Record<string, Layout>) => mutatePage((p) => ({ ...p, visuals: p.visuals.map((v) => (layouts[v.id] ? { ...v, layout: layouts[v.id] } : v)) }));

  const save = (thenView = false) => start(async () => {
    const r = await saveReport({ id, title, description, doc });
    if (!r.ok || !r.id) { flash(false, r.error ?? "Save failed."); return; }
    setDirty(false);
    if (thenView) { router.push(`/analytics/custom/${r.id}`); return; }
    flash(true, "Saved ✓");
    if (!id) { setId(r.id); router.replace(`/analytics/custom/${r.id}/edit`); }
  });

  // Pages.
  const addPage = () => { setDoc((d) => ({ ...d, pages: [...d.pages, { id: uid(), name: `Page ${d.pages.length + 1}`, filters: { datePreset: "all" }, visuals: [] }] })); setPageIdx(doc.pages.length); setSelectedId(null); setDirty(true); };
  const deletePage = async (i: number) => {
    const p = doc.pages[i];
    if (doc.pages.length === 1) return;
    if (p.visuals.length && !(await confirm({ title: `Delete “${p.name}”?`, message: `Its ${p.visuals.length} visual(s) will be removed.`, confirmLabel: "Delete page" }))) return;
    setDoc((d) => ({ ...d, pages: d.pages.filter((_, k) => k !== i) }));
    setPageIdx((x) => Math.max(0, Math.min(x, doc.pages.length - 2)));
    setSelectedId(null); setDirty(true);
  };
  const movePage = (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= doc.pages.length) return;
    setDoc((d) => { const pages = [...d.pages]; [pages[i], pages[j]] = [pages[j], pages[i]]; return { ...d, pages }; });
    setPageIdx(j); setDirty(true);
  };

  // Delete key removes the selected visual (not while typing).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (!selectedId || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable) return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeVisual(selectedId); }
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const canvasDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    e.preventDefault();
    const { ds, field } = JSON.parse(raw) as { ds: string; field: string };
    const el = (e.target as HTMLElement).closest("[data-vid]") as HTMLElement | null;
    applyField(ds, field, el?.dataset.vid ?? null);
  };

  const terms = search.trim().toLowerCase();
  return (
    <div className="-mx-4 -my-5 flex min-h-[calc(100vh-64px)] flex-col bg-[#F7F8F6] lg:-mx-8 lg:-my-7 lg:flex-row">
      {dialog}
      {/* ── Left: header, page filters, canvas, page tabs ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-[#E5E7E3] bg-white px-4 py-2.5">
          <Link href={id ? `/analytics/custom/${id}` : "/analytics?tab=mine"} onClick={(e) => { if (dirty && !window.confirm("Leave without saving your changes?")) e.preventDefault(); }}
            className="text-[12.5px] font-semibold text-[#2E7D32] hover:underline">← {id ? "View report" : "Back"}</Link>
          <input value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} aria-label="Report name"
            className="min-w-[180px] flex-1 rounded-md border border-transparent px-2 py-1 text-[16px] font-bold text-[#1A1C1A] hover:border-[#E0E0E0] focus:border-[#2E7D32] focus:outline-none" />
          <input value={description} onChange={(e) => { setDescription(e.target.value); setDirty(true); }} placeholder="Short description (optional)" aria-label="Description"
            className="hidden w-[240px] rounded-md border border-transparent px-2 py-1 text-[12.5px] text-[#616161] hover:border-[#E0E0E0] focus:border-[#2E7D32] focus:outline-none md:block" />
          {msg && <span className={`text-[12px] font-semibold ${msg.ok ? "text-[#2E7D32]" : "max-w-[360px] text-[#C62828]"}`}>{msg.text}</span>}
          {dirty && !msg && <span className="text-[11.5px] text-[#B26A00]">Unsaved changes</span>}
          <button type="button" onClick={() => save(false)} disabled={saving} className="rounded-[10px] border border-[#2E7D32] bg-white px-4 py-1.5 text-[13px] font-semibold text-[#2E7D32] disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
          <button type="button" onClick={() => save(true)} disabled={saving} className="rounded-[10px] bg-[#2E7D32] px-4 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50">Save & view</button>
        </div>

        <div className="border-b border-[#E5E7E3] bg-white px-4 py-2">
          <div className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.5px] text-[#9E9E9E]">Page filters — saved as this page’s defaults (viewers can change them)</div>
          <PageFiltersBar filters={page.filters ?? {}} onChange={(f) => mutatePage((p) => ({ ...p, filters: f }))} cf={cf} onClearCf={() => setCf(null)} />
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4" onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_MIME)) e.preventDefault(); }} onDrop={canvasDrop}>
          {page.visuals.length === 0 ? (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center rounded-[14px] border-2 border-dashed border-[#D5D7D1] bg-white/60 text-center">
              <div className="text-[28px]">📊</div>
              <div className="mt-1 text-[14px] font-bold text-[#1A1C1A]">Start building</div>
              <div className="mt-1 max-w-[380px] text-[12.5px] text-[#757575]">Pick a visual on the right, then click or drag fields from the Data panel onto it. Or just drag a field here and we’ll pick a chart for you.</div>
            </div>
          ) : (
            <GridCanvas visuals={page.visuals} filters={page.filters ?? {}} cf={cf} onCrossFilter={setCf} editing selectedId={selectedId}
              onSelect={setSelectedId} onLayout={onLayout} onRemove={removeVisual} />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1 border-t border-[#E5E7E3] bg-white px-3 py-1.5">
          {doc.pages.map((p, i) => (
            <div key={p.id} className={`group flex items-center rounded-[8px] ${i === pageIdx ? "bg-[#E8F5E9]" : "hover:bg-[#F5F5F3]"}`}>
              {renaming === p.id ? (
                <input autoFocus defaultValue={p.name} onBlur={(e) => { const name = e.target.value.trim() || p.name; setDoc((d) => ({ ...d, pages: d.pages.map((x) => (x.id === p.id ? { ...x, name } : x)) })); setRenaming(null); setDirty(true); }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className="w-[120px] rounded border border-[#2E7D32] px-2 py-1 text-[12.5px]" />
              ) : (
                <button type="button" onClick={() => { setPageIdx(i); setSelectedId(null); setCf(null); }} onDoubleClick={() => setRenaming(p.id)} title="Double-click to rename"
                  className={`px-3 py-1.5 text-[12.5px] font-semibold ${i === pageIdx ? "text-[#2E7D32]" : "text-[#616161]"}`}>{p.name}</button>
              )}
              {i === pageIdx && (
                <span className="flex items-center pr-1 text-[11px] text-[#9E9E9E]">
                  <button type="button" onClick={() => movePage(i, -1)} disabled={i === 0} className="px-1 disabled:opacity-30" aria-label="Move page left">◀</button>
                  <button type="button" onClick={() => movePage(i, 1)} disabled={i === doc.pages.length - 1} className="px-1 disabled:opacity-30" aria-label="Move page right">▶</button>
                  <button type="button" onClick={() => setRenaming(p.id)} className="px-1" aria-label="Rename page">✎</button>
                  {doc.pages.length > 1 && <button type="button" onClick={() => deletePage(i)} className="px-1 hover:text-[#C62828]" aria-label="Delete page">×</button>}
                </span>
              )}
            </div>
          ))}
          <button type="button" onClick={addPage} className="rounded-[8px] px-3 py-1.5 text-[12.5px] font-semibold text-[#2E7D32] hover:bg-[#F1F8F1]">+ Page</button>
        </div>
      </div>

      {/* ── Right: Visuals / Build / Data ── */}
      <aside className="w-full shrink-0 border-l border-[#E5E7E3] bg-white lg:sticky lg:top-0 lg:h-[calc(100vh-64px)] lg:w-[320px] lg:overflow-y-auto">
        <Section title="Visuals" hint={selected ? "Click to change the selected visual" : "Click to add to the page"}>
          <div className="grid grid-cols-5 gap-1.5">
            {(Object.keys(VISUAL_META) as VisualType[]).map((t) => (
              <button key={t} type="button" onClick={() => pickType(t)} title={VISUAL_META[t].label}
                className={`flex h-[46px] flex-col items-center justify-center rounded-[8px] border text-[16px] ${selected?.type === t ? "border-[#2E7D32] bg-[#E8F5E9]" : "border-[#EAEAE6] hover:border-[#2E7D32]/50 hover:bg-[#FAFDF9]"}`}>
                {VISUAL_META[t].icon}
                <span className="text-[8.5px] font-semibold text-[#757575]">{VISUAL_META[t].label.replace(" chart", "")}</span>
              </button>
            ))}
          </div>
        </Section>

        {selected && <BuildPanel v={selected} onChange={(fn) => updateVisual(selected.id, fn)} onDropField={(ds, f, well) => applyField(ds, f, selected.id, well)} onRemove={() => removeVisual(selected.id)} />}

        <Section title="Data" hint="Click a field to add it, or drag it onto a visual / a well">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search fields…" className="mb-2 w-full rounded-lg border border-[#E0E0E0] px-2.5 py-1.5 text-[12.5px]" />
          {DATASETS.map((d) => {
            const fields = d.fields.filter((f) => !terms || f.label.toLowerCase().includes(terms) || d.label.toLowerCase().includes(terms));
            if (!fields.length) return null;
            const isOpen = !!terms || open.has(d.id);
            const locked = !!selected?.dataset && selected.dataset !== d.id;
            return (
              <div key={d.id} className="mb-1">
                <button type="button" onClick={() => setOpen((s) => { const x = new Set(s); if (x.has(d.id)) x.delete(d.id); else x.add(d.id); return x; })}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-[#F5F7F5]" title={d.description}>
                  <span className="text-[10px] text-[#9E9E9E]">{isOpen ? "▾" : "▸"}</span>
                  <span className="text-[13px]">{d.icon}</span>
                  <span className={`flex-1 text-[12.5px] font-bold ${locked ? "text-[#BDBDBD]" : "text-[#1A1C1A]"}`}>{d.label}</span>
                  {selected?.dataset === d.id && <span className="rounded-full bg-[#E8F5E9] px-1.5 text-[9.5px] font-bold text-[#2E7D32]">IN USE</span>}
                </button>
                {isOpen && (
                  <div className="ml-4 border-l border-[#EEE] pl-2">
                    {fields.map((f) => <FieldRow key={f.id} ds={d.id} f={f} locked={locked} onClick={() => applyField(d.id, f.id)} />)}
                  </div>
                )}
              </div>
            );
          })}
        </Section>
      </aside>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[#F0F0EC] px-3.5 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.6px] text-[#616161]">{title}</span>
        {hint && <span className="truncate text-[10.5px] text-[#9E9E9E]">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function FieldRow({ ds, f, locked, onClick }: { ds: string; f: FieldMeta; locked: boolean; onClick: () => void }) {
  return (
    <div draggable={!locked} onDragStart={(e) => { e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ ds, field: f.id })); e.dataTransfer.effectAllowed = "copy"; }}
      onClick={locked ? undefined : onClick} title={locked ? "The selected visual uses another table" : f.hint ?? "Click to add · drag onto a visual or well"}
      className={`flex items-center gap-2 rounded-md px-1.5 py-1 text-[12.5px] ${locked ? "cursor-not-allowed text-[#C4C4C0]" : "cursor-grab text-[#333] hover:bg-[#F1F8F1] active:cursor-grabbing"}`}>
      <span className={`w-[20px] shrink-0 text-center text-[10px] font-bold ${f.kind === "measure" ? "text-[#E65100]" : f.kind === "num" ? "text-[#1565C0]" : "text-[#757575]"}`}>{f.date ? "📅" : KIND_ICON[f.kind]}</span>
      <span className="min-w-0 flex-1 truncate">{f.label}</span>
    </div>
  );
}

/** The selected visual's wells (drop targets), title and options. */
function BuildPanel({ v, onChange, onDropField, onRemove }: { v: Visual; onChange: (fn: (v: Visual) => Visual) => void; onDropField: (ds: string, field: string, well: Well) => void; onRemove: () => void }) {
  const meta = VISUAL_META[v.type];
  const ds = v.dataset;
  const [over, setOver] = useState<Well | null>(null);
  const drop = (well: Well) => ({
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes(DRAG_MIME)) { e.preventDefault(); e.stopPropagation(); setOver(well); } },
    onDragLeave: () => setOver(null),
    onDrop: (e: React.DragEvent) => { const raw = e.dataTransfer.getData(DRAG_MIME); setOver(null); if (!raw) return; e.preventDefault(); e.stopPropagation(); const { ds: d, field } = JSON.parse(raw); onDropField(d, field, well); },
  });
  const wellCls = (w: Well) => `min-h-[36px] rounded-[8px] border border-dashed p-1.5 ${over === w ? "border-[#2E7D32] bg-[#F1F8F1]" : "border-[#DADAD4] bg-[#FAFAF8]"}`;
  const dimChip = (ref: FieldRef, onRemoveChip: () => void, onGrain: (g: DateGrain) => void) => {
    const f = fieldMeta(ds, ref.field);
    return (
      <div key={ref.field} className="mb-1 flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[12px] shadow-[0_0_0_1px_#E5E5E0]">
        <span className="min-w-0 flex-1 truncate font-semibold text-[#1A1C1A]">{f?.label ?? ref.field}</span>
        {f?.date && (
          <select value={ref.grain ?? "month"} onChange={(e) => onGrain(e.target.value as DateGrain)} className="rounded border border-[#E0E0E0] bg-white px-1 py-0.5 text-[11px]">
            {(Object.keys(GRAIN_LABEL) as DateGrain[]).map((g) => <option key={g} value={g}>{GRAIN_LABEL[g]}</option>)}
          </select>
        )}
        <button type="button" onClick={onRemoveChip} aria-label="Remove" className="px-1 text-[#9E9E9E] hover:text-[#C62828]">×</button>
      </div>
    );
  };
  const empty = (txt: string) => <div className="px-1 py-1 text-[11px] text-[#ABABA5]">{txt}</div>;
  const setDims = (dims: FieldRef[]) => onChange((x) => normalize({ ...x, dims }));

  return (
    <div className="border-b border-[#F0F0EC] bg-[#FBFCFA] px-3.5 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.6px] text-[#616161]">Build · {meta.label}</span>
        {ds && <span className="rounded-full bg-[#E8F5E9] px-2 py-0.5 text-[10.5px] font-semibold text-[#2E7D32]">{DATASET_BY_ID[ds]?.icon} {DATASET_BY_ID[ds]?.label}</span>}
      </div>

      <label className="mb-1 block text-[11px] font-semibold text-[#757575]">Title</label>
      <input value={v.title ?? ""} placeholder={visualTitle({ ...v, title: undefined })} onChange={(e) => onChange((x) => ({ ...x, title: e.target.value }))}
        className="mb-2.5 w-full rounded-lg border border-[#E0E0E0] px-2.5 py-1.5 text-[12.5px]" />

      {meta.axis && (
        <div className="mb-2.5">
          <div className="mb-1 text-[11px] font-semibold text-[#757575]">{meta.axis}</div>
          <div className={wellCls("axis")} {...drop("axis")}>
            {v.axis ? dimChip(v.axis, () => onChange((x) => normalize({ ...x, axis: null })), (g) => onChange((x) => ({ ...x, axis: { ...x.axis!, grain: g } }))) : empty("Drop a category or date")}
          </div>
        </div>
      )}
      {meta.split && (
        <div className="mb-2.5">
          <div className="mb-1 text-[11px] font-semibold text-[#757575]">{meta.split} <span className="font-normal text-[#ABABA5]">(optional)</span></div>
          <div className={wellCls("split")} {...drop("split")}>
            {v.split ? dimChip(v.split, () => onChange((x) => normalize({ ...x, split: null })), (g) => onChange((x) => ({ ...x, split: { ...x.split!, grain: g } }))) : empty("Drop a category to split by")}
          </div>
        </div>
      )}
      {meta.dims && (
        <div className="mb-2.5">
          <div className="mb-1 text-[11px] font-semibold text-[#757575]">Rows <span className="font-normal text-[#ABABA5]">(up to 4)</span></div>
          <div className={wellCls("dims")} {...drop("dims")}>
            {(v.dims ?? []).length ? (v.dims ?? []).map((d, i) => dimChip(d, () => setDims((v.dims ?? []).filter((_, k) => k !== i)), (g) => setDims((v.dims ?? []).map((x, k) => (k === i ? { ...x, grain: g } : x))))) : empty("Drop categories / dates")}
          </div>
        </div>
      )}
      <div className="mb-2.5">
        <div className="mb-1 text-[11px] font-semibold text-[#757575]">Values <span className="font-normal text-[#ABABA5]">(up to {meta.maxValues})</span></div>
        <div className={wellCls("values")} {...drop("values")}>
          {v.values.length ? v.values.map((x, i) => {
            const f = fieldMeta(ds, x.field);
            const aggs = aggsFor(f);
            return (
              <div key={`${x.field}-${i}`} className="mb-1 flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[12px] shadow-[0_0_0_1px_#E5E5E0]">
                <span className="min-w-0 flex-1 truncate font-semibold text-[#1A1C1A]" title={valueLabel(ds, x)}>{f?.label ?? x.field}</span>
                {aggs.length > 0 && (
                  <select value={x.agg ?? aggs[0]} onChange={(e) => onChange((vv) => ({ ...vv, values: vv.values.map((y, k) => (k === i ? { ...y, agg: e.target.value as Agg } : y)) }))}
                    className="rounded border border-[#E0E0E0] bg-white px-1 py-0.5 text-[11px]">
                    {aggs.map((a) => <option key={a} value={a}>{AGG_LABEL[a]}</option>)}
                  </select>
                )}
                <button type="button" onClick={() => onChange((vv) => ({ ...vv, values: vv.values.filter((_, k) => k !== i) }))} aria-label="Remove" className="px-1 text-[#9E9E9E] hover:text-[#C62828]">×</button>
              </div>
            );
          }) : empty("Drop a number (Σ measures, # columns)")}
        </div>
      </div>

      {["column", "bar", "donut", "treemap", "matrix"].includes(v.type) && (
        <div className="mb-2 flex items-center gap-2">
          <label className="text-[11px] font-semibold text-[#757575]">Show top</label>
          <input type="number" min={3} max={v.type === "matrix" ? 200 : 50} value={v.topN ?? (v.type === "donut" ? 8 : v.type === "treemap" ? 30 : v.type === "matrix" ? 50 : 15)}
            onChange={(e) => onChange((x) => ({ ...x, topN: Math.max(3, Math.min(x.type === "matrix" ? 200 : 50, Number(e.target.value) || 10)) }))}
            className="w-[64px] rounded-lg border border-[#E0E0E0] px-2 py-1 text-[12px]" />
          <span className="text-[11px] text-[#9E9E9E]">rest grouped as “Other”</span>
        </div>
      )}
      {["column", "bar", "area"].includes(v.type) && v.split && (
        <label className="mb-2 flex items-center gap-2 text-[12px] text-[#424242]">
          <input type="checkbox" checked={!!v.stacked} onChange={(e) => onChange((x) => ({ ...x, stacked: e.target.checked }))} className="h-3.5 w-3.5 accent-[#2E7D32]" /> Stack the split
        </label>
      )}
      <div className="mt-1 flex gap-2">
        {ds && <button type="button" onClick={() => onChange((x) => ({ ...x, dataset: null, axis: null, split: null, dims: x.type === "table" ? [] : undefined, values: [] }))} className="text-[12px] font-semibold text-[#757575] hover:underline">Clear fields</button>}
        <button type="button" onClick={onRemove} className="ml-auto text-[12px] font-semibold text-[#C62828] hover:underline">Remove visual</button>
      </div>
    </div>
  );
}
