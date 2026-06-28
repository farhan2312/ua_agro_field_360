"use client";

import { initials } from "@/lib/format";
import { EmptyState } from "@/components/ui";
import { EditPencil } from "./EditPencil";
import type { StoreRow } from "./types";

const GRID =
  "grid grid-cols-[36px_1.8fr_1fr_1.1fr_1.1fr_0.5fr_80px] px-[22px] items-center";

function OfficerCell({
  name,
  bg,
  color,
}: {
  name: string;
  bg: string;
  color: string;
}) {
  if (!name) return <div />;
  return (
    <div className="flex items-center gap-[6px]">
      <div
        className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-[9px] font-bold"
        style={{ background: bg, color }}
      >
        {initials(name)}
      </div>
      <div className="text-[12px] font-medium text-[#1A1C1A]">{name}</div>
    </div>
  );
}

function StorefrontIcon({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 14 14" fill="white">
      <path d="M1 5.5l1-3h10l1 3v1H1V5.5z" opacity="0.9" />
      <rect x="2" y="6.5" width="10" height="6" rx="0.5" fill="white" />
      <rect x="5" y="8.5" width="4" height="4" rx="0.5" fill={color} />
    </svg>
  );
}

export function StoresTab({
  rows,
  canEdit,
  totals,
}: {
  rows: StoreRow[];
  canEdit: boolean;
  totals: { stores: number; farmersMapped: number; officers: number };
}) {
  const kpis = [
    { iconBg: "#E8F5E9", emoji: "🏪", value: totals.stores, label: "Total Stores" },
    {
      iconBg: "#E3F2FD",
      emoji: "👨‍🌾",
      value: totals.farmersMapped,
      label: "Farmers Mapped",
    },
    {
      iconBg: "#FFF8E1",
      emoji: "👷",
      value: totals.officers,
      label: "Agri Officers Deployed",
    },
  ];

  return (
    <div>
      {/* Header row */}
      <div className="mb-5 flex items-center justify-between">
        <div className="text-[13px] text-[#757575]">
          Master data for store locations, assigned Agricultural Officers &amp; mapped
          farmers
        </div>
        <button
          type="button"
          className="cursor-pointer rounded-[10px] bg-[#2E7D32] px-[22px] py-[9px] text-[13px] font-semibold text-white hover:bg-[#1B5E20]"
        >
          + Add Store
        </button>
      </div>

      {/* KPI strip */}
      <div className="mb-5 grid grid-cols-3 gap-[14px]">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="flex items-center gap-[14px] rounded-xl border border-black/[0.03] bg-white px-[22px] py-[18px] shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
          >
            <div
              className="flex h-[42px] w-[42px] items-center justify-center rounded-[10px] text-[20px]"
              style={{ background: k.iconBg }}
            >
              {k.emoji}
            </div>
            <div>
              <div className="text-[22px] font-bold text-[#1A1C1A]">{k.value}</div>
              <div className="text-[11px] text-[#9E9E9E]">{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Store table */}
      <div className="overflow-hidden rounded-[14px] border border-black/[0.03] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div
          className={`${GRID} border-b border-[#F0F0F0] bg-[#FAFAFA] py-[14px] text-[10.5px] font-semibold uppercase tracking-[0.5px] text-[#9E9E9E]`}
        >
          <div />
          <div>Store</div>
          <div>District</div>
          <div>Agri Officer 1</div>
          <div>Agri Officer 2</div>
          <div>Farmers</div>
          <div />
        </div>

        {rows.length === 0 ? (
          <EmptyState title="No stores yet" hint="Seed the database to see stores." />
        ) : (
          rows.map((sr) => (
            <div key={sr.id} className={`${GRID} border-b border-[#F8F8F8] py-[14px]`}>
              <div
                className="h-[26px] w-[26px] flex-none rounded-md"
                style={{ background: sr.color }}
              />
              <div>
                <div className="text-[13px] font-bold text-[#1A1C1A]">{sr.name}</div>
                <div className="mt-[2px] text-[11px] text-[#9E9E9E]">{sr.address}</div>
              </div>
              <div className="text-[12.5px] text-[#616161]">{sr.district}</div>
              <OfficerCell name={sr.ao1} bg="#E3F2FD" color="#1565C0" />
              <OfficerCell name={sr.ao2} bg="#E8F5E9" color="#2E7D32" />
              <div className="text-[14px] font-bold text-[#1A1C1A]">{sr.farmerCount}</div>
              <div>
                {canEdit && (
                  <button
                    type="button"
                    className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-[#F5F7F5] px-[10px] py-[5px] text-[11px] font-semibold text-[#2E7D32] hover:bg-[#E8F5E9]"
                  >
                    <EditPencil />
                    Edit
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Farmer–Store mapping cards */}
      <div className="mt-5 grid grid-cols-3 gap-[14px]">
        {rows.map((sr) => (
          <div
            key={sr.id}
            className="overflow-hidden rounded-xl border border-black/[0.05] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
          >
            <div
              className="flex items-center gap-[10px] px-4 py-3"
              style={{ background: sr.color }}
            >
              <StorefrontIcon color={sr.color} />
              <div className="text-[12.5px] font-bold text-white">{sr.name}</div>
            </div>
            <div className="px-4 py-3">
              <div className="mb-[6px] text-[10px] font-bold uppercase tracking-[0.6px] text-[#9E9E9E]">
                Officers
              </div>
              <div className="mb-[10px] flex flex-wrap gap-[6px]">
                {sr.ao1 && (
                  <div className="rounded-[20px] bg-[#E3F2FD] px-[10px] py-[3px] text-[11px] font-semibold text-[#1565C0]">
                    {sr.ao1}
                  </div>
                )}
                {sr.ao2 && (
                  <div className="rounded-[20px] bg-[#E8F5E9] px-[10px] py-[3px] text-[11px] font-semibold text-[#2E7D32]">
                    {sr.ao2}
                  </div>
                )}
              </div>
              <div className="mb-[6px] text-[10px] font-bold uppercase tracking-[0.6px] text-[#9E9E9E]">
                Mapped Farmers
              </div>
              <div className="text-[12px] leading-[1.6] text-[#616161]">
                {sr.farmerNames || "—"}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
