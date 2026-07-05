"use client";

import { useRouter, usePathname } from "next/navigation";
import { SEGMENT_LABEL_TO_ENUM } from "@/lib/segments";
import type { SegmentCardVM } from "./types";

/**
 * Four segmentation summary cards (counts + ₹revenue per segment, computed over
 * ALL farmers). Clicking a card sets `?segment=` and clears the search, per the
 * original design (card click also resets search). Resets page to 1.
 */
export function SegmentSummaryCards({ cards }: { cards: SegmentCardVM[] }) {
  const router = useRouter();
  const pathname = usePathname();

  function selectSegment(label: SegmentCardVM["label"]) {
    const params = new URLSearchParams();
    params.set("segment", SEGMENT_LABEL_TO_ENUM[label]);
    // card click clears the search box (original UX)
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="grid grid-cols-2 gap-[14px] mb-5 lg:grid-cols-4">
      {cards.map((sc) => (
        <button
          key={sc.label}
          type="button"
          onClick={() => selectSegment(sc.label)}
          className="text-left bg-white rounded-xl px-[18px] py-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] border border-black/[0.03] border-t-[3px] cursor-pointer transition-shadow hover:shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
          style={{ borderTopColor: sc.color }}
        >
          <div className="text-[10px] font-semibold text-[#9E9E9E] uppercase tracking-[0.8px]">
            {sc.label}
          </div>
          <div className="flex items-end gap-2 mt-1.5">
            <div className="text-2xl font-bold text-[#1A1C1A]">{sc.count}</div>
            <div className="text-[11px] text-[#9E9E9E] mb-[3px]">farmers</div>
          </div>
          <div
            className="text-[11px] font-semibold mt-1"
            style={{ color: sc.color }}
          >
            {sc.revenue}
          </div>
        </button>
      ))}
    </div>
  );
}
