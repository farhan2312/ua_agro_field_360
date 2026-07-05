"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { SEGMENT_COLORS, SEGMENT_BGS, SEGMENT_LABEL_TO_ENUM } from "@/lib/segments";
import type { SegFilterVM } from "./types";

/**
 * Search box (debounced → writes `?q=`) + 5 segment filter chips
 * (`All` + the four segments → writes `?segment=`). Both reset `?page=`.
 * Per the original UX, chip clicks do NOT clear the search box.
 */
export function FarmerFilterBar({
  search,
  filters,
}: {
  search: string;
  filters: SegFilterVM[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(search);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // keep input in sync if the URL changes externally (e.g. card click clears q)
  useEffect(() => setValue(search), [search]);

  function pushSearch(next: string) {
    const params = new URLSearchParams();
    if (next.trim()) params.set("q", next.trim());
    // preserve the active segment filter
    const active = filters.find((f) => f.active && f.value !== null);
    if (active?.value) params.set("segment", SEGMENT_LABEL_TO_ENUM[active.value]);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function onSearchChange(next: string) {
    setValue(next);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => pushSearch(next), 300);
  }

  function selectFilter(f: SegFilterVM) {
    const params = new URLSearchParams();
    if (value.trim()) params.set("q", value.trim()); // chip click keeps search
    if (f.value) params.set("segment", SEGMENT_LABEL_TO_ENUM[f.value]);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex flex-wrap gap-3 mb-4 items-center">
      <input
        type="text"
        placeholder="Search by name, village, or mobile..."
        value={value}
        onChange={(e) => onSearchChange(e.target.value)}
        className="flex-1 max-w-[420px] px-[18px] py-[11px] border-[1.5px] border-[#E0E0E0] rounded-xl text-[13px] bg-white box-border outline-none focus:border-[#2E7D32] focus:shadow-[0_0_0_3px_rgba(46,125,50,0.1)]"
      />
      {filters.map((f) => {
        const segColor = f.value ? SEGMENT_COLORS[f.value] : null;
        const segBg = f.value ? SEGMENT_BGS[f.value] : null;
        // active: All → dark grey bg; segment → its colour. text white, no border.
        // inactive: white bg, segColor (or #616161 for All) text, #E0E0E0 border.
        const style = f.active
          ? {
              background: f.value ? segColor! : "#424242",
              color: "#fff",
              borderColor: "transparent",
            }
          : {
              background: "#fff",
              color: segColor ?? "#616161",
              borderColor: "#E0E0E0",
            };
        return (
          <button
            key={f.label}
            type="button"
            onClick={() => selectFilter(f)}
            style={style}
            className="px-4 py-[7px] rounded-full text-[11.5px] font-semibold cursor-pointer border-[1.5px] transition-opacity hover:opacity-85"
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}
