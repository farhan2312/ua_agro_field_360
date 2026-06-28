"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import type { VisitFilterOptions, VisitFilterState } from "./types";

const PERIOD_PILLS: { label: string; key: string }[] = [
  { label: "Today", key: "today" },
  { label: "This Week", key: "week" },
  { label: "This Month", key: "month" },
  { label: "All Time", key: "all" },
];

const SELECT_CLASS =
  "px-3 py-[6px] border-[1.5px] border-[#E0E0E0] rounded-lg text-xs bg-white outline-none text-[#616161] cursor-pointer";

export function VisitFilterBar({
  filter,
  options,
  total,
}: {
  filter: VisitFilterState;
  options: VisitFilterOptions;
  total: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === "all") params.delete(key);
      else params.set(key, value);
      const qs = params.toString();
      router.push(qs ? `/visits?${qs}` : "/visits");
    },
    [router, searchParams],
  );

  return (
    <div className="bg-white rounded-xl px-5 py-[14px] shadow-[0_1px_3px_rgba(0,0,0,0.04)] border border-black/[0.03] mb-4">
      <div className="flex items-center gap-[10px] flex-wrap">
        {/* Period pills */}
        {PERIOD_PILLS.map((p) => {
          const active = filter.period === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setParam("period", p.key)}
              className="px-[14px] py-[6px] rounded-[20px] text-xs font-semibold cursor-pointer transition-all hover:opacity-85"
              style={{
                background: active ? "#1A3A1A" : "white",
                color: active ? "white" : "#616161",
                border: `1.5px solid ${active ? "#1A3A1A" : "#E0E0E0"}`,
              }}
            >
              {p.label}
            </button>
          );
        })}

        <div className="w-px h-6 bg-[#F0F0F0] mx-1" />

        {/* Officer filter */}
        <select
          value={filter.officer}
          onChange={(e) => setParam("officer", e.target.value)}
          className={SELECT_CLASS}
          aria-label="Filter by officer"
        >
          <option value="all">All Officers</option>
          {options.officers.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>

        {/* Store filter */}
        <select
          value={filter.store}
          onChange={(e) => setParam("store", e.target.value)}
          className={SELECT_CLASS}
          aria-label="Filter by store"
        >
          <option value="all">All Stores</option>
          {options.stores.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        {/* Visit type filter */}
        <select
          value={filter.type}
          onChange={(e) => setParam("type", e.target.value)}
          className={SELECT_CLASS}
          aria-label="Filter by visit type"
        >
          <option value="all">All Types</option>
          {options.types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <div className="ml-auto text-xs text-[#9E9E9E] font-medium">
          {total} visits found
        </div>
      </div>
    </div>
  );
}
