"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { segMeta } from "@/lib/campaign-segments";
import { cropLabel } from "@/lib/crops";
import type { SegFilterVM, FarmerFacetsVM, FarmerSelectedVM } from "./types";

/**
 * Search box (debounced → writes `?q=`) + campaign-segment filter chips
 * (`All` + HNI/Potential HNI/Regular/At Risk/New/Lapsed → writes `?segment=<key>`)
 * + dropdown filters: store, region (zone), crop, spend tier.
 * Every change resets `?page=` and preserves the other filters.
 */
export function FarmerFilterBar({
  search,
  filters,
  facets,
  selected,
}: {
  search: string;
  filters: SegFilterVM[];
  facets: FarmerFacetsVM;
  selected: FarmerSelectedVM;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(search);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // keep input in sync if the URL changes externally
  useEffect(() => setValue(search), [search]);

  /** Build the URL from the current selections, applying one override. */
  function push(overrides: Partial<FarmerSelectedVM & { q: string; segment: string | null }>) {
    const params = new URLSearchParams();
    const q = overrides.q !== undefined ? overrides.q : value;
    if (q.trim()) params.set("q", q.trim());
    const seg = overrides.segment !== undefined ? overrides.segment : filters.find((f) => f.active)?.value ?? null;
    if (seg) params.set("segment", seg);
    const store = overrides.store !== undefined ? overrides.store : selected.store;
    if (store) params.set("store", store);
    const zone = overrides.zone !== undefined ? overrides.zone : selected.zone;
    if (zone) params.set("zone", zone);
    const crop = overrides.crop !== undefined ? overrides.crop : selected.crop;
    if (crop) params.set("crop", crop);
    const spend = overrides.spend !== undefined ? overrides.spend : selected.spend;
    if (spend) params.set("spend", spend);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function onSearchChange(next: string) {
    setValue(next);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => push({ q: next }), 300);
  }

  const anyFilter = selected.store || selected.zone || selected.crop || selected.spend || filters.some((f) => f.active && f.value !== null);
  const select = "rounded-xl border-[1.5px] border-[#E0E0E0] bg-white px-3 py-[9px] text-[12.5px] text-[#424242] outline-none focus:border-[#2E7D32]";

  return (
    <div className="mb-4 flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search by name, village, or mobile..."
          value={value}
          onChange={(e) => onSearchChange(e.target.value)}
          className="flex-1 max-w-[420px] px-[18px] py-[11px] border-[1.5px] border-[#E0E0E0] rounded-xl text-[13px] bg-white box-border outline-none focus:border-[#2E7D32] focus:shadow-[0_0_0_3px_rgba(46,125,50,0.1)]"
        />
        {filters.map((f) => {
          const meta = f.value ? segMeta(f.value) : null;
          // active: All → dark grey bg; segment → its colour. text white, no border.
          // inactive: white bg, segment colour (or #616161 for All) text, #E0E0E0 border.
          const style = f.active
            ? {
                background: meta ? meta.color : "#424242",
                color: "#fff",
                borderColor: "transparent",
              }
            : {
                background: "#fff",
                color: meta?.color ?? "#616161",
                borderColor: "#E0E0E0",
              };
          return (
            <button
              key={f.label}
              type="button"
              onClick={() => push({ segment: f.value })}
              style={style}
              className="px-4 py-[7px] rounded-full text-[11.5px] font-semibold cursor-pointer border-[1.5px] transition-opacity hover:opacity-85"
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Dropdown filters: store · region · crop · spend tier */}
      <div className="flex flex-wrap items-center gap-2">
        <select className={select} value={selected.store ?? ""} onChange={(e) => push({ store: e.target.value || null })}>
          <option value="">All stores</option>
          {facets.stores.map((s) => (
            <option key={s.id} value={String(s.id)}>{s.name}</option>
          ))}
        </select>
        <select className={select} value={selected.zone ?? ""} onChange={(e) => push({ zone: e.target.value || null })}>
          <option value="">All regions</option>
          {facets.zones.map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>
        <select className={select} value={selected.crop ?? ""} onChange={(e) => push({ crop: e.target.value || null })}>
          <option value="">All crops</option>
          {facets.crops.map((c) => (
            <option key={c.crop} value={c.crop}>{cropLabel(c.crop)} ({c.count.toLocaleString("en-IN")})</option>
          ))}
        </select>
        <select className={select} value={selected.spend ?? ""} onChange={(e) => push({ spend: e.target.value || null })}>
          <option value="">All spend (12 mo)</option>
          {facets.spendTiers.map((t, i) => (
            <option key={t} value={String(i)}>{t}</option>
          ))}
        </select>
        {anyFilter && (
          <button
            type="button"
            onClick={() => router.push(value.trim() ? `${pathname}?q=${encodeURIComponent(value.trim())}` : pathname)}
            className="rounded-full border-[1.5px] border-[#E0E0E0] bg-white px-3.5 py-[7px] text-[11.5px] font-semibold text-[#C62828] hover:opacity-85"
          >
            ✕ Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
