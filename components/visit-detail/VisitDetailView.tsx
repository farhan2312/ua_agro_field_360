"use client";

import Link from "next/link";
import type { RecCard } from "@/lib/visit-types";

export interface VisitDetailData {
  vid: string;
  date: string;
  purpose: string;
  notes: string;
  officer: string;
  village: string;
  district: string;
  crop: string;
  land: string;
  segment: string;
  storeName: string;
  typeColor: string;
  storeColor: string;
  followup: string;
  followupBg: string;
  followupColor: string;
  segBg: string;
  segColor: string;
  farmerName: string;
  farmerMobile: string;
  init: string;
  avatarBg: string;
  farmerId: number | null;
  recs: RecCard[];
  gps: string;
  gpsVerified: boolean;
  year: string;
}

const CARD =
  "bg-white rounded-[14px] shadow-[0_1px_3px_rgba(0,0,0,0.04)] border border-black/[0.03]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] text-[#9E9E9E] font-semibold uppercase">{label}</div>
      <div className="text-[13px] font-semibold text-[#1A1C1A] mt-[3px]">{children}</div>
    </div>
  );
}

export function VisitDetailView({ data }: { data: VisitDetailData }) {
  return (
    <div className="motion-safe:animate-[fadeUp_0.4s_ease-out]">
      {/* Back nav */}
      <Link
        href="/visits"
        className="inline-flex items-center gap-[6px] text-[13px] text-[#757575] cursor-pointer mb-5 hover:text-[#2E7D32]"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 2L4 7l5 5" />
        </svg>
        Back to Visit Repository
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_1.4fr] gap-[18px]">
        {/* LEFT column */}
        <div className="flex flex-col gap-[14px]">
          {/* Visit header card */}
          <div className={`${CARD} p-[22px]`}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[10.5px] font-bold text-[#9E9E9E] uppercase tracking-[0.7px] mb-1">
                  Visit ID · {data.date}
                </div>
                <div className="text-[18px] font-bold text-[#1A1C1A]">{data.vid}</div>
              </div>
              <div
                className="px-[14px] py-1 rounded-[20px] text-[11px] font-bold whitespace-nowrap"
                style={{ background: data.followupBg, color: data.followupColor }}
              >
                Follow-up: {data.followup}
              </div>
            </div>

            {/* Visit-type badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-[10px] bg-[#F5F7F5] mb-4">
              <div className="w-[10px] h-[10px] rounded-full" style={{ background: data.typeColor }} />
              <span className="text-[13px] font-semibold text-[#1A1C1A]">{data.purpose}</span>
            </div>

            {/* Field rows */}
            <div className="flex flex-col border border-[#F0F0F0] rounded-[10px] overflow-hidden">
              <div className="grid grid-cols-2 px-[14px] py-[9px] bg-[#FAFAFA] border-b border-[#F5F5F5]">
                <Field label="Officer">{data.officer || "—"}</Field>
                <Field label="Date">
                  {data.date}
                  {data.date && data.year ? `, ${data.year}` : data.year}
                </Field>
              </div>
              <div className="grid grid-cols-2 px-[14px] py-[9px] border-b border-[#F5F5F5]">
                <Field label="Village">{data.village || "—"}</Field>
                <Field label="District">{data.district || "—"}</Field>
              </div>
              <div className="grid grid-cols-2 px-[14px] py-[9px] bg-[#FAFAFA] border-b border-[#F5F5F5]">
                <Field label="Crop">{data.crop || "—"}</Field>
                <Field label="Land">{data.land ? `${data.land} acres` : "—"}</Field>
              </div>
              <div className="grid grid-cols-2 px-[14px] py-[9px]">
                <div>
                  <div className="text-[10px] text-[#9E9E9E] font-semibold uppercase">Store</div>
                  <div className="flex items-center gap-[5px] mt-[3px]">
                    <div
                      className="w-2 h-2 rounded-[2px] shrink-0"
                      style={{ background: data.storeColor }}
                    />
                    <div className="text-[13px] font-semibold text-[#1A1C1A]">
                      {data.storeName || "—"}
                    </div>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[#9E9E9E] font-semibold uppercase">Segment</div>
                  <div className="mt-1">
                    {data.segment ? (
                      <span
                        className="inline-block px-[9px] py-[2px] rounded-[20px] text-[10px] font-semibold"
                        style={{ background: data.segBg, color: data.segColor }}
                      >
                        {data.segment}
                      </span>
                    ) : (
                      <span className="text-[13px] font-semibold text-[#1A1C1A]">—</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Farmer mini card */}
          <div className={`${CARD} p-[18px]`}>
            <div className="text-[11px] font-bold text-[#9E9E9E] uppercase tracking-[0.6px] mb-3">
              Farmer
            </div>
            <div className="flex items-center gap-3 mb-[14px]">
              <div
                className="w-11 h-11 rounded-full flex items-center justify-center font-bold text-[15px] text-white shrink-0"
                style={{ background: data.avatarBg }}
              >
                {data.init}
              </div>
              <div>
                <div className="text-[15px] font-bold text-[#1A1C1A]">{data.farmerName || "—"}</div>
                <div className="text-[11.5px] text-[#9E9E9E] mt-[2px]">{data.farmerMobile}</div>
              </div>
            </div>
            {data.farmerId != null ? (
              <Link
                href={`/farmers/${data.farmerId}`}
                className="p-[10px] rounded-[10px] bg-[#F5F7F5] text-[#2E7D32] text-[12.5px] font-semibold cursor-pointer text-center flex items-center justify-center gap-[6px] hover:bg-[#E8F5E9]"
              >
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="#2E7D32" strokeWidth="2" strokeLinecap="round">
                  <circle cx="7" cy="4" r="3" />
                  <path d="M1 13c0-3 2.7-5 6-5s6 2 6 5" />
                </svg>
                View Full Farmer Profile
              </Link>
            ) : (
              <div className="p-[10px] rounded-[10px] bg-[#F5F7F5] text-[#9E9E9E] text-[12.5px] font-semibold text-center flex items-center justify-center gap-[6px]">
                No linked farmer profile
              </div>
            )}
          </div>
        </div>

        {/* RIGHT column */}
        <div className="flex flex-col gap-[14px]">
          {/* Field Notes */}
          <div className={`${CARD} p-[22px]`}>
            <div className="flex items-center gap-2 mb-[14px] text-[15px] font-bold text-[#1A1C1A]">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#2E7D32" strokeWidth="2" strokeLinecap="round">
                <rect x="2" y="2" width="12" height="12" rx="2" />
                <path d="M5 6h6M5 9h4" />
              </svg>
              Field Notes
            </div>
            <div className="text-[13.5px] text-[#424242] leading-[1.75] p-4 bg-[#FAFFF9] rounded-[10px] border-[1.5px] border-[#E8F5E9]">
              {data.notes || "No field notes recorded for this visit."}
            </div>
          </div>

          {/* Recommendations & Actions */}
          <div className={`${CARD} p-[22px]`}>
            <div className="flex items-center gap-2 mb-[14px] text-[15px] font-bold text-[#1A1C1A]">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#1565C0" strokeWidth="2" strokeLinecap="round">
                <circle cx="8" cy="8" r="6" />
                <path d="M8 5v4M8 11v1" />
              </svg>
              Recommendations &amp; Actions
            </div>
            <div className="flex flex-col gap-[10px]">
              {data.recs.map((rec, i) => (
                <div
                  key={i}
                  className="flex items-start gap-[10px] px-[14px] py-3 bg-[#F5F7F5] rounded-[10px]"
                >
                  <div
                    className="w-2 h-2 rounded-full shrink-0 mt-[5px]"
                    style={{ background: rec.c }}
                  />
                  <div className="text-[12.5px] text-[#424242] leading-[1.65]">{rec.t}</div>
                </div>
              ))}
            </div>
          </div>

          {/* GPS + Meta */}
          <div className={`${CARD} py-[18px] px-[22px] flex items-center justify-between`}>
            <div className="flex items-center gap-[10px]">
              <div className="w-[34px] h-[34px] rounded-[8px] bg-[#E8F5E9] flex items-center justify-center shrink-0">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#2E7D32" strokeWidth="2">
                  <circle cx="7" cy="6" r="2" />
                  <path d="M7 1C4.2 1 2 3.2 2 6c0 3.8 5 9 5 9s5-5.2 5-9c0-2.8-2.2-5-5-5z" />
                </svg>
              </div>
              <div>
                <div className="text-[10px] font-bold text-[#9E9E9E] uppercase">GPS Location</div>
                <div className="text-[12.5px] font-semibold text-[#2E7D32] mt-[2px]">{data.gps}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-bold text-[#9E9E9E] uppercase">Logged by</div>
              <div className="text-[12.5px] font-semibold text-[#1A1C1A] mt-[2px]">
                {data.officer || "—"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
