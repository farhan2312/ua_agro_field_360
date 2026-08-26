"use client";

import { useEffect, useState, useTransition } from "react";
import { getStoreTagState, setStoreTags, type StoreTagVM } from "@/app/actions/store-tags";

/** Assign/unassign store tags from the Map store panel. RM (own stores) + central/sysadmin can edit. */
export function StoreTagEditor({ storeId }: { storeId: number }) {
  const [tags, setTags] = useState<StoreTagVM[] | null>(null);
  const [assigned, setAssigned] = useState<Set<number>>(new Set());
  const [canEdit, setCanEdit] = useState(false);
  const [saving, start] = useTransition();

  useEffect(() => {
    let live = true;
    getStoreTagState(storeId).then((r) => { if (!live) return; setTags(r.tags); setAssigned(new Set(r.assigned)); setCanEdit(r.canEdit); }).catch(() => setTags([]));
    return () => { live = false; };
  }, [storeId]);

  const toggle = (id: number) => {
    if (!canEdit) return;
    const next = new Set(assigned);
    next.has(id) ? next.delete(id) : next.add(id);
    setAssigned(next);
    start(async () => { await setStoreTags(storeId, [...next]); });
  };

  if (tags == null) return null;
  const shown = canEdit ? tags : tags.filter((t) => assigned.has(t.id));
  if (!canEdit && shown.length === 0) return null; // nothing to show a viewer who can't edit

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-5 py-2.5">
      <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.4px] text-ink-muted">Tags{saving ? " · saving…" : ""}</span>
      {tags.length === 0 ? (
        <span className="text-[11px] text-ink-muted">No store tags defined yet (add them in Settings → Store Tags).</span>
      ) : shown.map((t) => {
        const on = assigned.has(t.id);
        return (
          <button key={t.id} type="button" onClick={() => toggle(t.id)} disabled={!canEdit || saving}
            className="rounded-full border-[1.5px] px-2.5 py-0.5 text-[11px] font-semibold transition-colors"
            style={{
              background: on ? t.color : "#fff", color: on ? "#fff" : t.color,
              borderColor: t.color, cursor: canEdit ? "pointer" : "default", opacity: canEdit ? 1 : 0.9,
            }}>
            {on ? "✓ " : ""}{t.name}
          </button>
        );
      })}
      {!canEdit && shown.length > 0 && <span className="text-[10px] text-ink-muted">(view only)</span>}
    </div>
  );
}
