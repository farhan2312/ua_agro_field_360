"use client";

import { ClusterMultiSelect } from "./ClusterMultiSelect";
import { EMPTY_LOC, LOC_DIMS, locActive, locOptions, pruneLoc, type LocFilter, type Located } from "@/lib/campaign-location";

/**
 * Region → Store → Village filter used on every campaign page. Options come from the farmers
 * on that page (`items`, optionally pre-counted with `n`) and cascade: picking a region narrows the
 * store list, picking a store narrows the villages. Picks that fall outside a narrowed parent
 * are dropped automatically.
 */
export function LocationFilterBar({ items, value, onChange, className = "" }: {
  items: (Located & { n?: number })[]; value: LocFilter; onChange: (f: LocFilter) => void; className?: string;
}) {
  const opts = locOptions(items, value);
  const set = (list: keyof LocFilter, ids: string[]) => onChange(pruneLoc(items, { ...value, [list]: ids }));
  return (
    <div className={className}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {LOC_DIMS.map((d) => {
          const o = opts[d.key];
          return (
            <div key={d.key} className="min-w-0">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase text-[#9E9E9E]">
                <span>{d.label}</span>
                {value[d.list].length > 0 && <button type="button" onClick={() => set(d.list, [])} className="text-[10.5px] normal-case text-[#C62828]">clear</button>}
              </div>
              <ClusterMultiSelect<string> options={o} value={value[d.list]} onChange={(ids) => set(d.list, ids)} compact
                noun={d.plural} emptyLabel={`All ${d.plural} (${o.length.toLocaleString("en-IN")})`} allLabel={`All ${o.length.toLocaleString("en-IN")} ${d.plural} selected`} />
            </div>
          );
        })}
      </div>
      {locActive(value) && (
        <button type="button" onClick={() => onChange(EMPTY_LOC)} className="mt-1.5 text-[11.5px] font-semibold text-[#C62828]">× Clear location filters</button>
      )}
    </div>
  );
}
