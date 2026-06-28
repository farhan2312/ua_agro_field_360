"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui";
import { Toggle } from "@/components/interactive";
import { initials, avatarColor } from "@/lib/format";
import {
  SEGMENT_BGS,
  SEGMENT_COLORS,
  type SegmentLabel,
} from "@/lib/segments";
import { ChipGroup } from "./ChipGroup";
import { VILLAGES, DISTRICTS, type WizardOptions } from "./field-options";
import { INITIAL_FORM, type VisitForm, type LookupFarmer } from "./types";
import { submitVisitAction } from "@/app/actions/new-visit";

const STEP_LABELS = [
  "Farmer & Location",
  "Land & Crops",
  "Products & Issues",
  "Commercial & Services",
  "Review & Submit",
];

/* ── Local field-label helper (shared across step panels) ── */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2.5 text-[12px] font-semibold text-[#616161]">{children}</div>
  );
}

/* ── Small inline SVGs (screen-specific) ── */
function PlusBadge() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="5.5" fill="#2E7D32" />
      <path d="M4 6h4M6 4v4" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function CheckBadge() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="#2E7D32">
      <path d="M6 1a5 5 0 100 10A5 5 0 006 1zm2.3 3.7l-2.6 2.6-1-1a.5.5 0 00-.7.7l1.4 1.4a.5.5 0 00.7 0l3-3a.5.5 0 00-.8-.7z" />
    </svg>
  );
}
function WarnTriangle() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="shrink-0">
      <path
        d="M12 3l9 16H3L12 3z"
        stroke="#F9A825"
        strokeWidth="2"
        strokeLinejoin="round"
        fill="#FFFDE7"
      />
      <path d="M12 9v4" stroke="#F9A825" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="16" r="1" fill="#F9A825" />
    </svg>
  );
}

export function NewVisitWizard({
  options,
  farmers,
  primaryIdLabel = "Mobile Number",
  visitReasonRequired = true,
}: {
  options: WizardOptions;
  farmers: LookupFarmer[];
  primaryIdLabel?: string;
  visitReasonRequired?: boolean;
}) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<VisitForm>(INITIAL_FORM);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof VisitForm>(key: K, value: VisitForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const onText =
    (key: keyof VisitForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      set(key, e.target.value as VisitForm[typeof key]);

  /* ── Mobile lookup (spec §3) ── */
  const lookup = useMemo(() => {
    const m = form.mobile.trim();
    if (m.length < 10) return { found: false, noMatch: false, farmer: null as LookupFarmer | null, idx: -1 };
    const idx = farmers.findIndex((f) => f.mobile === m);
    return idx >= 0
      ? { found: true, noMatch: false, farmer: farmers[idx], idx }
      : { found: false, noMatch: true, farmer: null, idx: -1 };
  }, [form.mobile, farmers]);

  const visitReasonStar = visitReasonRequired ? " *" : "";

  const next = () => setStep((s) => Math.min(s + 1, 4));
  const prev = () => setStep((s) => Math.max(s - 1, 0));
  const submit = () => startTransition(() => void submitVisitAction(form));

  return (
    <div className="mx-auto max-w-[800px] animate-fadeUp">
      {/* A. Progress steps */}
      <div className="mb-7 flex items-center gap-1">
        {STEP_LABELS.map((label, i) => {
          const circleBg = i === step ? "#2E7D32" : step > i ? "#66BB6A" : "#E0E0E0";
          const circleColor = step >= i ? "#FFFFFF" : "#9E9E9E";
          const textColor = i === step ? "#2E7D32" : step > i ? "#43A047" : "#BDBDBD";
          const lineBg = step > i ? "#66BB6A" : "#E8E8E8";
          return (
            <div key={label} className="flex flex-1 items-center gap-1">
              <div
                className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full text-[12px] font-bold"
                style={{ background: circleBg, color: circleColor }}
              >
                {i + 1}
              </div>
              <div
                className="whitespace-nowrap text-[11.5px]"
                style={{ color: textColor, fontWeight: i === step ? 600 : 400 }}
              >
                {label}
              </div>
              <div className="mx-1 h-[2px] flex-1" style={{ background: lineBg }} />
            </div>
          );
        })}
      </div>

      {/* B. Form card */}
      <div className="rounded-2xl border border-black/[0.03] bg-white p-8 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        {/* ── STEP 0 ── */}
        {step === 0 && (
          <div>
            <div className="mb-5 text-[18px] font-bold text-[#1A1C1A]">Farmer & Location</div>

            {/* Primary ID hero */}
            <div className="mb-5 rounded-[13px] border-[1.5px] border-[#A5D6A7] bg-gradient-to-br from-[#F1F8F1] to-[#E8F5E9] p-5">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.7px] text-[#2E7D32]">
                <PlusBadge />
                {primaryIdLabel} — Unique Identifier *
              </div>
              <input
                type="tel"
                inputMode="numeric"
                placeholder="Enter 10-digit mobile number"
                value={form.mobile}
                onChange={onText("mobile")}
                className="w-full rounded-[10px] border-2 border-[#C8E6C9] bg-white px-4 py-[13px] text-[16px] tracking-[1px] outline-none focus:border-[#2E7D32] focus:ring-[3px] focus:ring-[#2E7D32]/[0.12]"
              />
              <div className="mt-[7px] text-[11px] text-[#757575]">
                Used as the unique identifier for this farmer record
              </div>
            </div>

            {/* Returning farmer card */}
            {lookup.found && lookup.farmer && (
              <div className="mb-[18px] rounded-xl border-[1.5px] border-[#A5D6A7] bg-[#E8F5E9] px-4 py-3.5">
                <div className="mb-2.5 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.7px] text-[#2E7D32]">
                  <CheckBadge />
                  Returning Farmer Found
                </div>
                <div className="mb-3 flex items-center gap-3">
                  <Avatar
                    size={40}
                    initials={initials(lookup.farmer.name)}
                    background={avatarColor(lookup.idx)}
                  />
                  <div className="flex-1">
                    <div className="text-[14.5px] font-bold text-[#1A1C1A]">
                      {lookup.farmer.name}
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-[#616161]">
                      {[lookup.farmer.village, lookup.farmer.district]
                        .filter(Boolean)
                        .join(", ") || "—"}
                    </div>
                  </div>
                  {lookup.farmer.segmentLabel && (
                    <span
                      className="rounded-full px-2.5 py-[3px] text-[10.5px] font-bold"
                      style={{
                        background: SEGMENT_BGS[lookup.farmer.segmentLabel as SegmentLabel] ?? "#F5F5F5",
                        color: SEGMENT_COLORS[lookup.farmer.segmentLabel as SegmentLabel] ?? "#9E9E9E",
                      }}
                    >
                      {lookup.farmer.segmentLabel}
                    </span>
                  )}
                </div>
                <div className="mb-3 grid grid-cols-3 gap-2">
                  {[
                    { label: "Crop", value: lookup.farmer.crop ?? "—", green: false },
                    { label: "Last Visit", value: "—", green: false },
                    { label: "Lifetime Value", value: "—", green: true },
                  ].map((cell) => (
                    <div key={cell.label} className="rounded-lg bg-white px-2.5 py-2">
                      <div className="text-[9px] font-semibold uppercase text-[#9E9E9E]">
                        {cell.label}
                      </div>
                      <div
                        className="mt-0.5 text-[12.5px] font-semibold"
                        style={{ color: cell.green ? "#2E7D32" : "#1A1C1A" }}
                      >
                        {cell.value}
                      </div>
                    </div>
                  ))}
                </div>
                <Link
                  href={`/farmers/${lookup.farmer.id}`}
                  className="block rounded-lg bg-[#2E7D32] py-[9px] text-center text-[12px] font-semibold text-white hover:bg-[#1B5E20]"
                >
                  View Full Profile →
                </Link>
              </div>
            )}

            {/* New farmer banner */}
            {lookup.noMatch && (
              <div className="mb-[18px] flex items-center gap-2 rounded-[10px] border-[1.5px] border-[#FFE082] bg-[#FFF8E1] px-3.5 py-[11px]">
                <WarnTriangle />
                <span className="text-[12px] font-medium text-[#795548]">
                  New farmer — no existing record for this mobile. Continuing as new registration.
                </span>
              </div>
            )}

            {/* Farmer details grid */}
            <div className="mb-[18px] grid grid-cols-2 gap-4">
              <div>
                <FieldLabel>Farmer Name *</FieldLabel>
                <input
                  type="text"
                  placeholder="Enter farmer name"
                  value={form.name}
                  onChange={onText("name")}
                  className="w-full rounded-[10px] border-[1.5px] border-[#E0E0E0] px-3.5 py-[11px] text-[14px] outline-none focus:border-[#2E7D32]"
                />
              </div>
              <div>
                <FieldLabel>Father/Husband Name</FieldLabel>
                <input
                  type="text"
                  placeholder="Enter name"
                  value={form.father}
                  onChange={onText("father")}
                  className="w-full rounded-[10px] border-[1.5px] border-[#E0E0E0] px-3.5 py-[11px] text-[14px] outline-none focus:border-[#2E7D32]"
                />
              </div>
              <div>
                <FieldLabel>Village *</FieldLabel>
                <select
                  value={form.village}
                  onChange={onText("village")}
                  className="w-full rounded-[10px] border-[1.5px] border-[#E0E0E0] bg-white px-3.5 py-[11px] text-[14px] outline-none focus:border-[#2E7D32]"
                >
                  {VILLAGES.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel>District</FieldLabel>
                <select
                  value={form.district}
                  onChange={onText("district")}
                  className="w-full rounded-[10px] border-[1.5px] border-[#E0E0E0] bg-white px-3.5 py-[11px] text-[14px] outline-none focus:border-[#2E7D32]"
                >
                  {DISTRICTS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mb-4">
              <FieldLabel>Visit Reason{visitReasonStar}</FieldLabel>
              <input
                type="text"
                placeholder="e.g. Crop inspection, Product demo, Follow-up..."
                value={form.visitPurpose}
                onChange={onText("visitPurpose")}
                className="w-full rounded-[10px] border-[1.5px] border-[#E0E0E0] px-3.5 py-[11px] text-[14px] outline-none focus:border-[#2E7D32]"
              />
            </div>

            <div className="flex items-center gap-2.5 rounded-[10px] bg-[#F5F7F5] px-[18px] py-3.5">
              <div className="h-2 w-2 rounded-full bg-[#2E7D32]" />
              <div className="text-[12px] text-[#616161]">
                GPS Location:{" "}
                <span className="font-semibold text-[#2E7D32]">27.1767° N, 78.0081° E</span> — Confirmed
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 1 ── */}
        {step === 1 && (
          <div>
            <div className="mb-5 text-[18px] font-bold text-[#1A1C1A]">Land & Crops</div>

            <div className="mb-5">
              <FieldLabel>Land Holding *</FieldLabel>
              <ChipGroup
                options={options.landHolding}
                value={form.landHolding}
                onChange={(v) => set("landHolding", v)}
              />
            </div>

            <div className="mb-5 grid grid-cols-2 gap-4">
              <div>
                <FieldLabel>Soil Type</FieldLabel>
                <ChipGroup
                  size="sm"
                  options={options.soilType}
                  value={form.soil}
                  onChange={(v) => set("soil", v)}
                />
              </div>
              <div>
                <FieldLabel>Soil Testing</FieldLabel>
                <ChipGroup
                  size="sm"
                  options={options.soilTesting}
                  value={form.soilTesting}
                  onChange={(v) => set("soilTesting", v)}
                />
              </div>
            </div>

            <div className="mb-5">
              <FieldLabel>Water Source</FieldLabel>
              <ChipGroup
                multi
                options={options.waterSource}
                value={form.waterSource}
                onChange={(v) => set("waterSource", v)}
              />
            </div>

            <div className="mb-5">
              <FieldLabel>Main Crop *</FieldLabel>
              <ChipGroup
                options={options.mainCrop}
                value={form.mainCrop}
                onChange={(v) => set("mainCrop", v)}
              />
            </div>

            <div className="mb-5">
              <FieldLabel>Other Crops Grown</FieldLabel>
              <ChipGroup
                multi
                size="sm"
                options={options.crop}
                value={form.crop}
                onChange={(v) => set("crop", v)}
              />
            </div>

            <div className="mb-5 grid grid-cols-2 gap-4">
              <div>
                <FieldLabel>Season *</FieldLabel>
                <ChipGroup
                  options={options.season}
                  value={form.season}
                  onChange={(v) => set("season", v)}
                />
              </div>
              <div className="flex items-center gap-3.5 pt-[22px]">
                <div className="text-[12px] font-semibold text-[#616161]">Crop Insured?</div>
                <Toggle checked={form.cropInsured} onChange={(v) => set("cropInsured", v)} />
              </div>
            </div>

            <div>
              <FieldLabel>Other Crops & Vegetables (free text)</FieldLabel>
              <input
                type="text"
                placeholder="e.g. Coriander, Garlic..."
                value={form.otherCrops}
                onChange={onText("otherCrops")}
                className="w-full rounded-[10px] border-[1.5px] border-[#E0E0E0] px-3.5 py-2.5 text-[13px] outline-none focus:border-[#2E7D32]"
              />
            </div>
          </div>
        )}

        {/* ── STEP 2 ── */}
        {step === 2 && (
          <div>
            <div className="mb-5 text-[18px] font-bold text-[#1A1C1A]">Products & Issues</div>
            {(
              [
                ["Products Currently Using", "product"],
                ["Products Required", "productRequired"],
                ["Current Problem", "currentProblem"],
                ["Crop Risk", "cropRisk"],
                ["Danger Zone", "dangerZone"],
              ] as const
            ).map(([label, key], i, arr) => (
              <div key={key} className={i < arr.length - 1 ? "mb-[18px]" : ""}>
                <FieldLabel>{label}</FieldLabel>
                <ChipGroup
                  multi
                  size="sm"
                  options={options[key]}
                  value={form[key]}
                  onChange={(v) => set(key, v)}
                />
              </div>
            ))}
          </div>
        )}

        {/* ── STEP 3 ── */}
        {step === 3 && (
          <div>
            <div className="mb-5 text-[18px] font-bold text-[#1A1C1A]">Commercial & Services</div>

            <div className="mb-[18px]">
              <FieldLabel>Annual Agriculture Expense</FieldLabel>
              <ChipGroup
                options={options.annualExpense}
                value={form.annualExpense}
                onChange={(v) => set("annualExpense", v)}
              />
            </div>

            <div className="mb-[18px]">
              <FieldLabel>Purchase Frequency</FieldLabel>
              <ChipGroup
                options={options.purchaseFreq}
                value={form.purchaseFreq}
                onChange={(v) => set("purchaseFreq", v)}
              />
            </div>

            <div className="mb-5">
              <FieldLabel>Other Shops Buy From</FieldLabel>
              <input
                type="text"
                placeholder="e.g. Local market, XYZ Agri Store..."
                value={form.otherShops}
                onChange={onText("otherShops")}
                className="w-full rounded-[10px] border-[1.5px] border-[#E0E0E0] px-3.5 py-2.5 text-[13px] outline-none focus:border-[#2E7D32]"
              />
            </div>

            <div className="mb-3.5 border-t border-[#F0F0F0] pt-1 text-[13px] font-bold text-[#424242]">
              Services & Membership
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-4">
              {(
                [
                  ["FPO Member?", "fpoMember"],
                  ["Contract Farming?", "contractFarming"],
                  ["Dairy Services?", "dairyServices"],
                  ["WhatsApp Available?", "whatsappAvail"],
                ] as const
              ).map(([label, key]) => (
                <div key={key} className="flex items-center gap-3">
                  <div className="flex-1 text-[12px] font-semibold text-[#616161]">{label}</div>
                  <Toggle checked={form[key]} onChange={(v) => set(key, v)} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── STEP 4 ── */}
        {step === 4 && (
          <div>
            <div className="mb-5 text-[18px] font-bold text-[#1A1C1A]">Review & Submit</div>

            <div className="mb-5">
              <FieldLabel>Lead Status *</FieldLabel>
              <ChipGroup
                options={options.leadStatus}
                value={form.leadStatus}
                onChange={(v) => set("leadStatus", v)}
              />
            </div>

            <div className="mb-6">
              <FieldLabel>Follow-up Date</FieldLabel>
              <input
                type="date"
                value={form.followUpDate}
                onChange={onText("followUpDate")}
                className="rounded-[10px] border-[1.5px] border-[#E0E0E0] px-3.5 py-[11px] text-[14px] outline-none focus:border-[#2E7D32]"
              />
            </div>

            <div className="mb-5 rounded-xl bg-[#F5F7F5] p-[18px]">
              <div className="mb-3 text-[13px] font-bold text-[#1A1C1A]">Visit Summary</div>
              <div className="grid grid-cols-2 gap-2 text-[12px]">
                {(
                  [
                    ["Farmer", form.name],
                    ["Mobile", form.mobile],
                    ["Village", form.village],
                    ["Land", form.landHolding],
                    ["Main Crop", form.mainCrop],
                    ["Season", form.season],
                    ["Expense", form.annualExpense],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="text-[#757575]">
                    {label}:{" "}
                    <span className="font-semibold text-[#1A1C1A]">{value}</span>
                  </div>
                ))}
                <div className="text-[#757575]">
                  Status: <span className="font-semibold text-[#2E7D32]">{form.leadStatus}</span>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              {["+ Attach Photos", "+ Record Voice Note"].map((label) => (
                <button
                  key={label}
                  type="button"
                  className="flex-1 rounded-[10px] border-[1.5px] border-dashed border-[#BDBDBD] px-7 py-3.5 text-center text-[13px] text-[#757575] hover:border-[#2E7D32] hover:text-[#2E7D32]"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Wizard nav */}
        <div className="mt-7 flex justify-between border-t border-[#F0F0F0] pt-5">
          {step > 0 ? (
            <button
              type="button"
              onClick={prev}
              className="rounded-[10px] border-[1.5px] border-[#E0E0E0] px-7 py-[11px] text-[13px] font-semibold text-[#616161] hover:border-[#2E7D32] hover:text-[#2E7D32]"
            >
              Previous
            </button>
          ) : (
            <div />
          )}
          {step < 4 ? (
            <button
              type="button"
              onClick={next}
              className="rounded-[10px] bg-[#2E7D32] px-8 py-[11px] text-[13px] font-semibold text-white hover:bg-[#1B5E20] active:scale-[0.97]"
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="rounded-[10px] bg-[#2E7D32] px-8 py-[11px] text-[13px] font-semibold text-white hover:bg-[#1B5E20] active:scale-[0.97] disabled:opacity-60"
            >
              {pending ? "Submitting…" : "Submit Visit"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
