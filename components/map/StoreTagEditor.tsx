"use client";

import { useEffect, useState, useTransition } from "react";
import { getStoreTagsBulkState, applyStoreTagBulk, type StoreTagVM } from "@/app/actions/store-tags";

/**
 * Assign/unassign store tags from the Map store panel — one store or many at once.
 * RM (own stores) + central/sysadmin can edit. With several stores selected, each chip is tri-state:
 * all-selected have it (✓ solid), some do (count shown), or none. Clicking fills all / clears all.
 */
export function StoreTagEditor({ storeIds }: { storeIds: number[] }) {
  const [tags, setTags] = useState<StoreTagVM[] | null>(null);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [total, setTotal] = useState(0);
  const [editable, setEditable] = useState(0);
  const [canEdit, setCanEdit] = useState(false);
  const [saving, start] = useTransition();

  const key = storeIds.join(",");
  const reload = () =>
    getStoreTagsBulkState(storeIds).then((r) => {
      setTags(r.tags); setCounts(r.counts); setTotal(r.total); setEditable(r.editable); setCanEdit(r.canEdit);
    }).catch(() => setTags([]));

  useEffect(() => { let live = true; getStoreTagsBulkState(storeIds).then((r) => { if (!live) return; setTags(r.tags); setCounts(r.counts); setTotal(r.total); setEditable(r.editable); setCanEdit(r.canEdit); }).catch(() => setTags([])); return () => { live = false; }; }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: number, allOn: boolean) => {
    if (!canEdit || saving) return;
    // Optimistic: fill to editable (or full) when turning on, clear to 0 when turning off.
    setCounts((c) => ({ ...c, [id]: allOn ? 0 : Math.max(total, editable) }));
    start(async () => { await applyStoreTagBulk(storeIds, id, !allOn); await reload(); });
  };

  if (tags == null) return null;
  const multi = total > 1;
  const shown = canEdit ? tags : tags.filter((t) => (counts[t.id] ?? 0) > 0);
  if (!canEdit && shown.length === 0) return null; // nothing to show a viewer who can't edit

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-5 py-2.5">
      <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.4px] text-ink-muted">
        Tags{multi ? ` · ${total} stores` : ""}{saving ? " · saving…" : ""}
      </span>
      {tags.length === 0 ? (
        <span className="text-[11px] text-ink-muted">No store tags defined yet (add them in Settings → Store Tags).</span>
      ) : shown.map((t) => {
        const c = counts[t.id] ?? 0;
        const allOn = c > 0 && c >= total;         // every selected store carries it
        const some = c > 0 && c < total;            // partial (multi only)
        return (
          <button key={t.id} type="button" onClick={() => toggle(t.id, allOn)} disabled={!canEdit || saving}
            title={multi ? `${c} of ${total} selected have “${t.name}”` : undefined}
            className="rounded-full border-[1.5px] px-2.5 py-0.5 text-[11px] font-semibold transition-colors"
            style={{
              background: allOn ? t.color : "#fff",
              color: allOn ? "#fff" : t.color,
              borderColor: t.color,
              borderStyle: some ? "dashed" : "solid",
              cursor: canEdit ? "pointer" : "default",
              opacity: canEdit ? 1 : 0.9,
            }}>
            {allOn ? "✓ " : ""}{t.name}{some ? ` · ${c}/${total}` : ""}
          </button>
        );
      })}
      {canEdit && multi && editable < total && (
        <span className="text-[10px] text-ink-muted">applying to your {editable} of {total}</span>
      )}
      {!canEdit && shown.length > 0 && <span className="text-[10px] text-ink-muted">(view only)</span>}
    </div>
  );
}
