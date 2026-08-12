/**
 * Shared personalization variables for campaign messaging. One token set fills both:
 *   • SMS  — named [slots] in the comm-plan text (e.g. [Naam], [Store]).
 *   • WhatsApp — positional {{1}},{{2}}… mapped in the comm plan's `waVariables` order.
 * All tokens resolve off the Farmer row (+ campaign end date) so a bulk broadcast needs no per-farmer
 * extra queries.
 */
import { cropLabel } from "@/lib/crops";
import { shortStoreName } from "@/lib/store-utils";

/** Tokens an admin can map into a WhatsApp template's variables (order = {{1}},{{2}}…). */
export const WA_VAR_TOKENS: { key: string; label: string; slot: string }[] = [
  { key: "name", label: "Farmer first name", slot: "[Naam]" },
  { key: "fullname", label: "Farmer full name", slot: "[fullname]" },
  { key: "crop", label: "Main crop", slot: "[crop]" },
  { key: "store", label: "Store name", slot: "[Store]" },
  { key: "village", label: "Village", slot: "[village]" },
  { key: "gap", label: "₹ to reach HNI", slot: "[gap]" },
  { key: "mobile", label: "Mobile number", slot: "[number]" },
  { key: "date", label: "Campaign end date", slot: "[date]" },
];
export const VAR_LABEL: Record<string, string> = Object.fromEntries(WA_VAR_TOKENS.map((t) => [t.key, t.label]));

export interface FarmerVarSource {
  name: string | null;
  mobile: string | null;
  village: string | null;
  hniGap: number | null;
  cropTags: string[];
  crop: string | null;
  storeName: string | null;
}

/** token → resolved string for one farmer. */
export function resolveVars(f: FarmerVarSource, endDate?: Date | null): Record<string, string> {
  const first = (f.name ?? "").trim().split(/\s+/)[0] || "";
  const crop = f.cropTags?.[0] ? cropLabel(f.cropTags[0]) : (f.crop ?? "");
  return {
    name: first,
    fullname: (f.name ?? "").trim(),
    crop,
    store: f.storeName ? shortStoreName(f.storeName) : "",
    village: (f.village ?? "").trim(),
    gap: f.hniGap != null && f.hniGap > 0 ? Math.round(f.hniGap).toLocaleString("en-IN") : "",
    mobile: (f.mobile ?? "").trim(),
    date: endDate ? new Date(endDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "",
  };
}

/** Fill an SMS-style template with named [slots]. */
export function fillNamedTemplate(template: string, vars: Record<string, string>): string {
  let t = template;
  for (const { slot, key } of WA_VAR_TOKENS) {
    t = t.replace(new RegExp(slot.replace(/[[\]]/g, "\\$&"), "gi"), vars[key] ?? "");
  }
  // Also accept "[Store name]" as an alias for [Store].
  t = t.replace(/\[Store name\]/gi, vars.store ?? "");
  return t;
}

/** Positional params for a WhatsApp template body, in the comm plan's waVariables order. */
export function positionalParams(waVariables: string[] | null | undefined, vars: Record<string, string>): string[] {
  return (waVariables ?? []).map((tok) => vars[tok] ?? "");
}
