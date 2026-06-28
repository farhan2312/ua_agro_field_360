/** Map View layer colour engine, legend, and layer pills (from the design). */

export type MapLayerKey = "segment" | "crop" | "lastVisit" | "issues" | "leadStatus";

export const MAP_LAYER_PILLS: { key: MapLayerKey; label: string; swatch: string }[] = [
  { key: "segment", label: "Farmer Segment", swatch: "#2E7D32" },
  { key: "crop", label: "Crop", swatch: "#F9A825" },
  { key: "lastVisit", label: "Last Visited", swatch: "#E65100" },
  { key: "issues", label: "Issues & Concerns", swatch: "#C62828" },
  { key: "leadStatus", label: "Lead Status", swatch: "#7B1FA2" },
];

export const LAYER_LABELS: Record<MapLayerKey, string> = {
  segment: "Farmer Segment",
  crop: "Crop Type",
  lastVisit: "Last Visited",
  issues: "Issues & Concerns",
  leadStatus: "Lead Status",
};

const SEGMENT_FN: Record<string, string> = {
  "High Value": "#2E7D32", "Medium Value": "#1565C0", "New/Low": "#F57F17", Dormant: "#9E9E9E",
};
const CROP_FN: Record<string, string> = {
  Wheat: "#F9A825", Rice: "#66BB6A", Sugarcane: "#2E7D32", Potato: "#8D6E63",
  Mustard: "#FF8F00", Millets: "#78909C", Barley: "#FFA000", Paddy: "#66BB6A",
};
const ISSUE_FN: Record<string, string> = {
  "Pest Infestation": "#C62828", "Disease Infection": "#E65100", "Irrigation Issue": "#1565C0",
  "Nutrient Deficiency": "#7B1FA2", "Weed Problem": "#F57F17", None: "#2E7D32",
};
const LEAD_FN: Record<string, string> = {
  New: "#2E7D32", Contacted: "#1565C0", "Follow-up": "#E65100", Converted: "#7B1FA2", Lost: "#757575",
};

function lastVisitColor(daysAgo: number | null): string {
  if (daysAgo === null) return "#C62828";
  if (daysAgo <= 7) return "#2E7D32";
  if (daysAgo <= 14) return "#F9A825";
  if (daysAgo <= 30) return "#E65100";
  return "#C62828";
}

export interface FarmerLike {
  segment?: string | null; // display label
  crop?: string | null;
  issue?: string | null; // primary issue label or "None"
  leadStatus?: string | null; // display label
  daysSinceVisit?: number | null;
}

/** Pin colour for a farmer under the active layer. */
export function layerColor(layer: MapLayerKey, f: FarmerLike): string {
  switch (layer) {
    case "segment": return SEGMENT_FN[f.segment || ""] ?? "#9E9E9E";
    case "crop": return CROP_FN[f.crop || ""] ?? "#9E9E9E";
    case "issues": return ISSUE_FN[f.issue || "None"] ?? "#2E7D32";
    case "leadStatus": return LEAD_FN[f.leadStatus || ""] ?? "#757575";
    case "lastVisit": return lastVisitColor(f.daysSinceVisit ?? null);
  }
}

export const LEGEND_META: Record<MapLayerKey, { label: string; items: { label: string; color: string }[] }> = {
  segment: { label: "Farmer Segment", items: [
    { label: "High Value", color: "#2E7D32" }, { label: "Medium Value", color: "#1565C0" },
    { label: "New/Low", color: "#F57F17" }, { label: "Dormant", color: "#9E9E9E" }] },
  crop: { label: "Main Crop", items: [
    { label: "Wheat", color: "#F9A825" }, { label: "Sugarcane", color: "#2E7D32" },
    { label: "Rice/Paddy", color: "#66BB6A" }, { label: "Potato", color: "#8D6E63" },
    { label: "Mustard", color: "#FF8F00" }, { label: "Millets", color: "#78909C" },
    { label: "Barley", color: "#FFA000" }] },
  lastVisit: { label: "Last Visited", items: [
    { label: "Within 7 days", color: "#2E7D32" }, { label: "8–14 days", color: "#F9A825" },
    { label: "15–30 days", color: "#E65100" }, { label: ">30 days", color: "#C62828" }] },
  issues: { label: "Issues & Concerns", items: [
    { label: "Pest", color: "#C62828" }, { label: "Disease", color: "#E65100" },
    { label: "Irrigation", color: "#1565C0" }, { label: "Nutrient", color: "#7B1FA2" },
    { label: "Weed", color: "#F57F17" }, { label: "None", color: "#2E7D32" }] },
  leadStatus: { label: "Lead Status", items: [
    { label: "New", color: "#2E7D32" }, { label: "Contacted", color: "#1565C0" },
    { label: "Follow-up", color: "#E65100" }, { label: "Converted", color: "#7B1FA2" },
    { label: "Lost", color: "#757575" }] },
};

export const LAYER_FILTER_OPTS: Record<MapLayerKey, string[]> = {
  segment: ["all", "High Value", "Medium Value", "New/Low"],
  crop: ["all", "Wheat", "Rice", "Sugarcane", "Potato", "Mustard"],
  lastVisit: ["all", "Recent (< 7 days)", "This Month", "Older"],
  issues: ["all", "Active Issues", "No Issues"],
  leadStatus: ["all", "New", "Contacted", "Follow-up", "Converted", "Lost"],
};
