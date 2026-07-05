/** Lead/visit status & user role colour maps (verbatim from the design). */

export interface ColorPair {
  bg: string;
  c: string;
}

/** Lead/visit status chips (stColors, design line 2778). */
export const STATUS_COLORS: Record<string, ColorPair> = {
  New: { bg: "#E8F5E9", c: "#2E7D32" },
  Contacted: { bg: "#E3F2FD", c: "#1565C0" },
  "Follow-up": { bg: "#FFF3E0", c: "#E65100" },
  Converted: { bg: "#F3E5F5", c: "#7B1FA2" },
  Recommendation: { bg: "#FFF8E1", c: "#F57F17" },
  Lost: { bg: "#FAFAFA", c: "#757575" },
  // also seen as farmer.status values:
  "High Value": { bg: "#E8F5E9", c: "#2E7D32" },
  Dormant: { bg: "#F5F5F5", c: "#9E9E9E" },
};

export function statusColor(s?: string | null): ColorPair {
  return (s && STATUS_COLORS[s]) || { bg: "#FAFAFA", c: "#757575" };
}

/** User-Management role chips (roleMeta). */
export const ROLE_META: Record<string, ColorPair> = {
  "Regional Manager": { bg: "#E8F5E9", c: "#2E7D32" },
  "Agri Officer": { bg: "#E3F2FD", c: "#1565C0" },
  "Central Admin": { bg: "#F3E5F5", c: "#7B1FA2" },
  "System Admin": { bg: "#FFF3E0", c: "#E65100" },
};

/** User active/inactive chips (statusMeta). */
export const USER_STATUS_META: Record<string, ColorPair> = {
  Active: { bg: "#E8F5E9", c: "#2E7D32" },
  Inactive: { bg: "#FFF3E0", c: "#E65100" },
};

/** Store status chips (Store Management tab). */
export const STORE_STATUS_META: Record<string, ColorPair> = {
  Active: { bg: "#E8F5E9", c: "#2E7D32" },
  Closed: { bg: "#FFEBEE", c: "#C62828" },
  Vacant: { bg: "#F5F5F5", c: "#9E9E9E" },
  "H.O.": { bg: "#F3E5F5", c: "#7B1FA2" },
};

/** Audit-log action chips. */
export const AUDIT_ACTION_META: Record<string, ColorPair> = {
  CREATE: { bg: "#E8F5E9", c: "#2E7D32" },
  UPDATE: { bg: "#E3F2FD", c: "#1565C0" },
  CONFIG: { bg: "#FFF3E0", c: "#E65100" },
  EXPORT: { bg: "#F3E5F5", c: "#7B1FA2" },
  DELETE: { bg: "#FFEBEE", c: "#C62828" },
};

/** Project status chips (newProjectStatusMeta). */
export const PROJECT_STATUS_META: Record<string, ColorPair & { label: string }> = {
  active: { label: "Active", bg: "#E8F5E9", c: "#2E7D32" },
  planned: { label: "Planned", bg: "#FFF8E1", c: "#F57F17" },
  completed: { label: "Completed", bg: "#F3E5F5", c: "#7B1FA2" },
};

/** Employee badge colour by empCode/designation prefix (empCodeRoleMeta). */
export function empBadge(designation?: string | null): ColorPair & { label?: string } {
  const d = (designation || "").toUpperCase();
  if (d.startsWith("AGC")) return { bg: "#E3F2FD", c: "#1565C0" };
  if (d.startsWith("CI")) return { bg: "#FFF8E1", c: "#E65100" };
  return { bg: "#F3E5F5", c: "#7B1FA2" };
}
