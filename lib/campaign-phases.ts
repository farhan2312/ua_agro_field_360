/**
 * Phased-campaign domain model (pure — safe to import from server actions AND client components).
 *
 * A campaign runs in ordered phases. Each phase's `type` fixes its behaviour-driven sub-cohorts (who
 * to contact and why), derived from each member's purchase status {booked, fertiliser, combo}. Within
 * a sub-cohort, farmers split by value band (HNI vs Others) — matching the "HNI : Call / Others : Text"
 * routing in the consumer-journey flow. `commConfig` maps sub-cohort × band → a comm plan + channel.
 */

export type PhaseType = "BOOKING" | "FERTILISER" | "COMBO" | "CUSTOM";
export type ValueBand = "HNI" | "OTHERS";
export type Channel = "CALL" | "SMS" | "WHATSAPP" | "VOICE_NOTE" | "IN_PERSON";

export interface Coupon { label: string; code: string; minSpend?: number }
export interface CommSlot { commPlan?: string; channel?: Channel }
/** { "<subCohortKey>": { HNI: {...}, OTHERS: {...} } } */
export type CommConfig = Record<string, Partial<Record<ValueBand, CommSlot>>>;

/** The three purchase flags that route a farmer through the phases. */
export interface MemberStatus { booked: boolean; boughtFertiliser: boolean; boughtCombo: boolean }

export interface SubCohortDef {
  key: string;
  label: string;
  goal: string; // what this phase tries to make them do
  match: (s: MemberStatus) => boolean;
}

/**
 * Sub-cohorts per phase type (straight from the consumer-journey decision tree). A member who matches
 * NONE of a phase's sub-cohorts is "converted/done" for that phase and receives no message.
 * Order matters — first match wins.
 */
export const PHASE_SUBCOHORTS: Record<PhaseType, SubCohortDef[]> = {
  BOOKING: [
    { key: "all", label: "All farmers", goal: "1:1 follow-up to book", match: () => true },
  ],
  FERTILISER: [
    { key: "booked_no_fertiliser", label: "Booked · no fertiliser yet", goal: "Push fertiliser purchase", match: (s) => s.booked && !s.boughtFertiliser },
    { key: "not_booked", label: "Not booked", goal: "Final booking / fertiliser follow-up", match: (s) => !s.booked && !s.boughtFertiliser },
  ],
  COMBO: [
    { key: "fertiliser_no_combo", label: "Bought fertiliser · no combo", goal: "Push combo", match: (s) => s.boughtFertiliser && !s.boughtCombo },
    { key: "no_fertiliser", label: "No fertiliser", goal: "Stop fertiliser msgs · combo only", match: (s) => !s.boughtFertiliser && !s.boughtCombo },
  ],
  CUSTOM: [
    { key: "all", label: "All farmers", goal: "Custom outreach", match: () => true },
  ],
};

export const PHASE_TYPES: { key: PhaseType; label: string }[] = [
  { key: "BOOKING", label: "Advance Booking" },
  { key: "FERTILISER", label: "Fertiliser Purchase" },
  { key: "COMBO", label: "Combo Only" },
  { key: "CUSTOM", label: "Custom" },
];

export const CHANNELS: { key: Channel; label: string }[] = [
  { key: "CALL", label: "Call" },
  { key: "SMS", label: "SMS" },
  { key: "WHATSAPP", label: "WhatsApp" },
  { key: "VOICE_NOTE", label: "Voice note" },
  { key: "IN_PERSON", label: "In person" },
];

export interface PhaseTemplate { ordinal: number; name: string; type: PhaseType }
/** The default 3-phase potato-campaign shape (add/remove/rename per campaign). */
export const DEFAULT_PHASES: PhaseTemplate[] = [
  { ordinal: 1, name: "Advance Booking", type: "BOOKING" },
  { ordinal: 2, name: "Fertiliser Purchase", type: "FERTILISER" },
  { ordinal: 3, name: "Combo Only", type: "COMBO" },
];

/** HNI is its own band; Potential-HNI + Regular collapse to "Others". */
export function valueBand(valueSegment: string | null | undefined): ValueBand {
  return valueSegment === "HNI" ? "HNI" : "OTHERS";
}

export function subCohortsFor(type: string): SubCohortDef[] {
  return PHASE_SUBCOHORTS[(type as PhaseType)] ?? PHASE_SUBCOHORTS.CUSTOM;
}

/** Which sub-cohort key a member falls in for a phase type — null = not targeted (converted/done). */
export function subCohortOf(type: string, s: MemberStatus): string | null {
  return subCohortsFor(type).find((d) => d.match(s))?.key ?? null;
}

export function phaseTypeLabel(type: string): string {
  return PHASE_TYPES.find((t) => t.key === type)?.label ?? "Custom";
}
export function channelLabel(ch: string | null | undefined): string {
  return CHANNELS.find((c) => c.key === ch)?.label ?? (ch ?? "—");
}

/** Coerce an unknown JSON blob (Prisma Json) into a Coupon[] safely. */
export function asCoupons(v: unknown): Coupon[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      label: String(x.label ?? "").trim(),
      code: String(x.code ?? "").trim(),
      minSpend: x.minSpend != null && !Number.isNaN(Number(x.minSpend)) ? Number(x.minSpend) : undefined,
    }))
    .filter((c) => c.code);
}

/** Coerce an unknown JSON blob into a CommConfig safely. */
export function asCommConfig(v: unknown): CommConfig {
  if (!v || typeof v !== "object") return {};
  const out: CommConfig = {};
  for (const [cohort, bands] of Object.entries(v as Record<string, unknown>)) {
    if (!bands || typeof bands !== "object") continue;
    const b: Partial<Record<ValueBand, CommSlot>> = {};
    for (const band of ["HNI", "OTHERS"] as ValueBand[]) {
      const slot = (bands as Record<string, unknown>)[band];
      if (slot && typeof slot === "object") {
        const s = slot as Record<string, unknown>;
        b[band] = {
          commPlan: s.commPlan ? String(s.commPlan) : undefined,
          channel: s.channel ? (String(s.channel) as Channel) : undefined,
        };
      }
    }
    out[cohort] = b;
  }
  return out;
}
