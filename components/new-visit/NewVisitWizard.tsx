"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
import { ChipGroupWithOther } from "./ChipGroupWithOther";
import { CropSelector } from "./CropSelector";
import { BucketSlider } from "./BucketSlider";
import { OtherReveal } from "./OtherReveal";
import { VILLAGES, DISTRICTS, type WizardOptions } from "./field-options";
import { INITIAL_FORM, type VisitForm, type FarmerLookup } from "./types";
import { submitVisitAction, lookupFarmerByMobile } from "@/app/actions/new-visit";

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
  primaryIdLabel = "Mobile Number",
  visitReasonRequired = true,
}: {
  options: WizardOptions;
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

  /* ── "Other" specify boxes (R6) + service detail boxes (R5) ── */
  type ServiceKey = "fpoMember" | "contractFarming" | "dairyServices" | "whatsappAvail";

  const setOtherText = (k: string, v: string) =>
    setForm((f) => ({ ...f, otherText: { ...f.otherText, [k]: v } }));

  const setServiceDetail = (k: string, v: string) =>
    setForm((f) => ({ ...f, serviceDetail: { ...f.serviceDetail, [k]: v } }));

  // Toggle a service on/off; clear its detail when off; seed WhatsApp from the
  // entered mobile the first time it's turned on.
  const setService = (key: ServiceKey, on: boolean) =>
    setForm((f) => {
      const serviceDetail = { ...f.serviceDetail };
      if (!on) serviceDetail[key] = "";
      else if (key === "whatsappAvail" && !serviceDetail.whatsappAvail)
        serviceDetail.whatsappAvail = f.mobile;
      return { ...f, [key]: on, serviceDetail } as VisitForm;
    });

  // Chip onChange wrapper that also drops the "Other" text when "Other" leaves
  // the selection, so abandoned detail is never persisted.
  const setChip =
    (key: keyof VisitForm, fieldKey: string) =>
    (v: string | string[]) =>
      setForm((f) => {
        const stillOther = Array.isArray(v) ? v.includes("Other") : v === "Other";
        return {
          ...f,
          [key]: v,
          otherText: stillOther ? f.otherText : { ...f.otherText, [fieldKey]: "" },
        } as VisitForm;
      });

  /* ── Server-side mobile lookup → autofill + edit mode ── */
  const [lookupStatus, setLookupStatus] = useState<"idle" | "loading" | "found" | "notfound">("idle");
  const [foundFarmer, setFoundFarmer] = useState<FarmerLookup | null>(null);
  const [editingFarmerId, setEditingFarmerId] = useState<number | null>(null);
  const [, startLookup] = useTransition();
  const lastQueried = useRef<string>("");

  useEffect(() => {
    const m = form.mobile.trim();
    if (m.length < 10) {
      setLookupStatus("idle");
      setFoundFarmer(null);
      setEditingFarmerId(null);
      lastQueried.current = "";
      return;
    }
    if (m === lastQueried.current) return;
    setLookupStatus("loading");
    const t = setTimeout(() => {
      lastQueried.current = m;
      startLookup(async () => {
        const res = await lookupFarmerByMobile(m);
        if (res.found && res.farmer) {
          const fa = res.farmer;
          setFoundFarmer(fa);
          setEditingFarmerId(fa.id);
          setLookupStatus("found");
          // Autofill the identity fields from the existing record (editable).
          setForm((prev) => {
            const nextMain = fa.mainCrop || prev.mainCrop;
            return {
              ...prev,
              name: fa.name || prev.name,
              village: fa.village || prev.village,
              district: fa.district || prev.district,
              mainCrop: nextMain,
              // Keep the CropSelector invariant: main is never also an "other".
              crop: prev.crop.filter((c) => c !== nextMain),
              leadStatus: fa.leadStatusLabel || prev.leadStatus,
            };
          });
        } else {
          setFoundFarmer(null);
          setEditingFarmerId(null);
          setLookupStatus("notfound");
        }
      });
    }, 450);
    return () => clearTimeout(t);
  }, [form.mobile]);

  const visitReasonStar = visitReasonRequired ? " *" : "";

  const next = () => setStep((s) => Math.min(s + 1, 4));
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  const submit = () => {
    // Fold each selected "Other" into "Other: <specified text>" so the typed
    // detail is persisted in the existing columns (no schema change for R6).
    const foldOne = (v: string, t?: string) =>
      v === "Other" && t?.trim() ? `Other: ${t.trim()}` : v;
    const foldArr = (a: string[], t?: string) => a.map((v) => foldOne(v, t));
    const ot = form.otherText;
    const payload: VisitForm = {
      ...form,
      soil: foldOne(form.soil, ot.soil),
      waterSource: foldArr(form.waterSource, ot.waterSource),
      mainCrop: foldOne(form.mainCrop, ot.crop),
      crop: foldArr(form.crop, ot.crop),
      product: foldArr(form.product, ot.product),
      productRequired: foldArr(form.productRequired, ot.productRequired),
      currentProblem: foldArr(form.currentProblem, ot.currentProblem),
      cropRisk: foldArr(form.cropRisk, ot.cropRisk),
    };
    startTransition(() => void submitVisitAction(payload, editingFarmerId));
  };

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
                {primaryIdLabel} *
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
                {lookupStatus === "loading"
                  ? "Looking up farmer…"
                  : "Enter a registered number to pull up and edit that farmer's details."}
              </div>
            </div>

            {/* Returning farmer card — details autofilled below, editable */}
            {lookupStatus === "found" && foundFarmer && (
              <div className="mb-[18px] rounded-xl border-[1.5px] border-[#A5D6A7] bg-[#E8F5E9] px-4 py-3.5">
                <div className="mb-2.5 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.7px] text-[#2E7D32]">
                  <CheckBadge />
                  Returning farmer — editing existing record
                </div>
                <div className="mb-3 flex items-center gap-3">
                  <Avatar
                    size={40}
                    initials={initials(foundFarmer.name)}
                    background={avatarColor(foundFarmer.id)}
                  />
                  <div className="flex-1">
                    <div className="text-[14.5px] font-bold text-[#1A1C1A]">
                      {foundFarmer.name}
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-[#616161]">
                      {[foundFarmer.village, foundFarmer.district]
                        .filter(Boolean)
                        .join(", ") || "—"}
                    </div>
                  </div>
                  {foundFarmer.segmentLabel && (
                    <span
                      className="rounded-full px-2.5 py-[3px] text-[10.5px] font-bold"
                      style={{
                        background: SEGMENT_BGS[foundFarmer.segmentLabel as SegmentLabel] ?? "#F5F5F5",
                        color: SEGMENT_COLORS[foundFarmer.segmentLabel as SegmentLabel] ?? "#9E9E9E",
                      }}
                    >
                      {foundFarmer.segmentLabel}
                    </span>
                  )}
                </div>
                <div className="mb-3 grid grid-cols-3 gap-2">
                  {[
                    { label: "Crop", value: foundFarmer.mainCrop || "—", green: false },
                    { label: "Last Visit", value: foundFarmer.lastVisit, green: false },
                    { label: "Lifetime Value", value: foundFarmer.ltv, green: true },
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
                <div className="mb-2.5 text-[11px] text-[#2E7D32]">
                  Details are autofilled below — edit any field and submit to update this farmer&apos;s
                  record.
                </div>
                <Link
                  href={`/farmers/${foundFarmer.id}`}
                  className="block rounded-lg bg-[#2E7D32] py-[9px] text-center text-[12px] font-semibold text-white hover:bg-[#1B5E20]"
                >
                  View Full Profile →
                </Link>
              </div>
            )}

            {/* New farmer banner */}
            {lookupStatus === "notfound" && (
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
                <input
                  type="text"
                  list="nv-villages"
                  placeholder="Village"
                  value={form.village}
                  onChange={onText("village")}
                  className="w-full rounded-[10px] border-[1.5px] border-[#E0E0E0] px-3.5 py-[11px] text-[14px] outline-none focus:border-[#2E7D32]"
                />
                <datalist id="nv-villages">
                  {VILLAGES.map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
              </div>
              <div>
                <FieldLabel>District</FieldLabel>
                <input
                  type="text"
                  list="nv-districts"
                  placeholder="District"
                  value={form.district}
                  onChange={onText("district")}
                  className="w-full rounded-[10px] border-[1.5px] border-[#E0E0E0] px-3.5 py-[11px] text-[14px] outline-none focus:border-[#2E7D32]"
                />
                <datalist id="nv-districts">
                  {DISTRICTS.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
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
              <BucketSlider
                options={options.landHolding}
                value={form.landHolding}
                onChange={(v) => set("landHolding", v)}
                ariaLabel="Land Holding"
              />
            </div>

            <div className="mb-5 grid grid-cols-2 items-start gap-4">
              <div>
                <FieldLabel>Soil Type</FieldLabel>
                <ChipGroupWithOther
                  size="sm"
                  fieldKey="soil"
                  options={options.soilType}
                  value={form.soil}
                  onChange={setChip("soil", "soil")}
                  detail={form.otherText.soil ?? ""}
                  onDetail={(t) => setOtherText("soil", t)}
                />
              </div>
              <div>
                <FieldLabel>Soil Testing</FieldLabel>
                <Toggle
                  ariaLabel="Soil Testing"
                  checked={form.soilTesting === "Required"}
                  onChange={(v) => set("soilTesting", v ? "Required" : "Not Required")}
                  labels={{ on: "Required", off: "Not Required" }}
                />
              </div>
            </div>

            <div className="mb-5">
              <FieldLabel>Water Source</FieldLabel>
              <ChipGroupWithOther
                multi
                fieldKey="waterSource"
                options={options.waterSource}
                value={form.waterSource}
                onChange={setChip("waterSource", "waterSource")}
                detail={form.otherText.waterSource ?? ""}
                onDetail={(t) => setOtherText("waterSource", t)}
              />
            </div>

            <div className="mb-5">
              <FieldLabel>
                Crops *{" "}
                <span className="font-normal text-[#9E9E9E]">
                  — pick crops, star the main one
                </span>
              </FieldLabel>
              <CropSelector
                options={options.crop}
                main={form.mainCrop}
                others={form.crop}
                onChange={({ main, others }) =>
                  setForm((f) => ({
                    ...f,
                    mainCrop: main,
                    crop: others,
                    otherText:
                      main === "Other" || others.includes("Other")
                        ? f.otherText
                        : { ...f.otherText, crop: "" },
                  }))
                }
                otherText={form.otherText.crop ?? ""}
                onOtherText={(v) => setOtherText("crop", v)}
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
                ["Products Currently Using", "product", true],
                ["Products Required", "productRequired", true],
                ["Current Problem", "currentProblem", true],
                ["Crop Risk", "cropRisk", true],
                ["Danger Zone", "dangerZone", false],
              ] as const
            ).map(([label, key, hasOther], i, arr) => (
              <div key={key} className={i < arr.length - 1 ? "mb-[18px]" : ""}>
                <FieldLabel>{label}</FieldLabel>
                {hasOther ? (
                  <ChipGroupWithOther
                    multi
                    size="sm"
                    fieldKey={key}
                    options={options[key]}
                    value={form[key]}
                    onChange={setChip(key, key)}
                    detail={form.otherText[key] ?? ""}
                    onDetail={(t) => setOtherText(key, t)}
                  />
                ) : (
                  <ChipGroup
                    multi
                    size="sm"
                    options={options[key]}
                    value={form[key]}
                    onChange={(v) => set(key, v)}
                  />
                )}
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
              <BucketSlider
                options={options.annualExpense}
                value={form.annualExpense}
                onChange={(v) => set("annualExpense", v)}
                ariaLabel="Annual Agriculture Expense"
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
            <div className="flex flex-col gap-2.5">
              {(
                [
                  ["FPO Member?", "fpoMember", "FPO / society name"],
                  ["Contract Farming?", "contractFarming", "Company & crop under contract"],
                  ["Dairy Services?", "dairyServices", "Dairy details (name, animals, litres/day)"],
                  ["WhatsApp Available?", "whatsappAvail", "WhatsApp number"],
                ] as const
              ).map(([label, key, ph]) => (
                <div key={key} className="rounded-[10px] border border-[#F0F0F0] px-3.5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[12px] font-semibold text-[#616161]">{label}</div>
                    <Toggle
                      ariaLabel={label}
                      checked={form[key]}
                      onChange={(v) => setService(key, v)}
                    />
                  </div>
                  <OtherReveal
                    show={form[key]}
                    value={form.serviceDetail[key] ?? ""}
                    onChange={(v) => setServiceDetail(key, v)}
                    placeholder={ph}
                    inputMode={key === "whatsappAvail" ? "numeric" : undefined}
                  />
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
