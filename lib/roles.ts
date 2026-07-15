/**
 * Role / persona model — verbatim from the original design (renderVals personas + nav flags).
 * The app uses a 4-persona switcher; each persona gates which nav items & screens are visible.
 */

export type RoleKey = "regional" | "officer" | "central" | "sysadmin";

export interface Persona {
  key: RoleKey;
  name: string;
  role: string;
  init: string;
  /** CSS gradient used for the avatar chip. */
  color: string;
}

export const PERSONAS: Record<RoleKey, Persona> = {
  regional: {
    key: "regional",
    name: "Rajesh Verma",
    role: "Regional Manager",
    init: "RV",
    color: "linear-gradient(135deg,#43A047,#F9A825)",
  },
  officer: {
    key: "officer",
    name: "Raj Kumar",
    role: "Agricultural Officer",
    init: "RK",
    color: "linear-gradient(135deg,#1565C0,#42A5F5)",
  },
  central: {
    key: "central",
    name: "Dr. Anita Sharma",
    role: "Central Admin",
    init: "AS",
    color: "linear-gradient(135deg,#7B1FA2,#CE93D8)",
  },
  sysadmin: {
    key: "sysadmin",
    name: "Vikash Mehta",
    role: "System Admin",
    init: "VM",
    color: "linear-gradient(135deg,#E65100,#FF8F00)",
  },
};

export const ROLE_ORDER: RoleKey[] = ["regional", "officer", "central", "sysadmin"];

/** Display label + avatar gradient for a role (reused from the persona map). */
export function roleLabel(key: RoleKey): string {
  return PERSONAS[key].role;
}
export function roleGradient(key: RoleKey): string {
  return PERSONAS[key].color;
}

/** Prisma Role enum ↔ persona RoleKey. */
export const PRISMA_TO_KEY: Record<string, RoleKey> = {
  SYSADMIN: "sysadmin",
  REGIONAL: "regional",
  CENTRAL: "central",
  ASR: "officer",
  STORE_MANAGER: "officer",
};
export const KEY_TO_PRISMA: Record<RoleKey, string> = {
  sysadmin: "SYSADMIN",
  regional: "REGIONAL",
  central: "CENTRAL",
  officer: "ASR",
};

/** Avatar gradient stops per role (used in the Users table + new accounts). */
export const ROLE_GRAD: Record<RoleKey, [string, string]> = {
  regional: ["#43A047", "#F9A825"],
  officer: ["#1565C0", "#42A5F5"],
  central: ["#7B1FA2", "#CE93D8"],
  sysadmin: ["#E65100", "#FF8F00"],
};

/** Roles a user may request at registration (admin is granted, not requested). */
export const REQUESTABLE_ROLES: { key: RoleKey; label: string }[] = [
  { key: "officer", label: "Agricultural Officer" },
  { key: "regional", label: "Regional Manager" },
  { key: "central", label: "Central Team" },
];

/** Roles a System Admin may assign when creating/editing a user (all four). */
export const ADMIN_ROLE_CHOICES: { key: RoleKey; label: string }[] = [
  { key: "officer", label: "Agri Officer" },
  { key: "regional", label: "Regional Manager" },
  { key: "central", label: "Central Admin" },
  { key: "sysadmin", label: "System Admin" },
];

/** Which views each role may access (from the showX flags in renderVals). */
export const NAV_VISIBILITY: Record<string, (r: RoleKey) => boolean> = {
  dashboard: () => true,
  newVisit: (r) => r === "regional" || r === "officer" || r === "sysadmin",
  visitRepo: () => true,
  farmers: () => true, // Farmer 360
  mapView: () => true,
  farmerCluster: () => true,
  masterData: (r) => r === "central" || r === "sysadmin",
  analytics: () => true,
  actions: (r) =>
    r === "regional" || r === "central" || r === "officer" || r === "sysadmin",
  campaigns: (r) => r === "regional" || r === "central" || r === "sysadmin",
  products: (r) => r === "regional" || r === "central" || r === "sysadmin",
  movement: (r) => r === "regional" || r === "central" || r === "sysadmin",
  users: (r) => r === "central" || r === "sysadmin",
  salesImport: (r) => r === "sysadmin",
  settings: (r) => r === "sysadmin",
  audit: (r) => r === "sysadmin",
};

export function canAccess(view: string, role: RoleKey): boolean {
  const fn = NAV_VISIBILITY[view];
  return fn ? fn(role) : true;
}

/** Per-role dashboard subtitle (from the dashSubs map). */
export const DASHBOARD_SUBTITLES: Record<RoleKey, string> = {
  regional: "Agra Region · Sunday, June 22, 2026",
  officer: "My Territory · Sunday, June 22, 2026",
  central: "All Regions · Organization Overview",
  sysadmin: "System Administration",
};

/** View title + subtitle (from the titles map). Subtitles that depend on role/data
 *  are resolved at render time; these are the static parts. */
export function viewTitle(
  view: string,
  role: RoleKey,
  extras?: { step?: number; projectCount?: number; activeCount?: number },
): [string, string] {
  switch (view) {
    case "dashboard":
      return ["Dashboard", DASHBOARD_SUBTITLES[role]];
    case "analytics":
      return [
        "Analytics & Insights",
        role === "central"
          ? "Cross-region performance analysis"
          : "Deep-dive into field operations data",
      ];
    case "newVisit":
      return ["New Visit Entry", `Step ${(extras?.step ?? 0) + 1} of 5`];
    case "farmers":
      return ["Farmer 360", "1,284 registered farmers · Segmented view"];
    case "farmerDetail":
      return ["Farmer 360 — Profile", ""];
    case "actions":
      return [
        "Action Planner",
        `${extras?.projectCount ?? 0} projects · ${extras?.activeCount ?? 0} active`,
      ];
    case "projectDetail":
      return ["Project Details", ""];
    case "mapView":
      return ["Map View", "Browse stores, filter farmers, and save clusters for action"];
    case "farmerCluster":
      return ["Segmentation", "Segmented farmer groups for targeted actions"];
    case "visitRepo":
      return [
        "Visit Repository",
        "Complete visit records across all officers & stores",
      ];
    case "visitDetail":
      return ["Visit Detail", ""];
    case "users":
      return ["User Management", "4 active users · Role-based access"];
    case "salesImport":
      return ["Sales Import", "Upload monthly invoice data"];
    case "settings":
      return ["System Settings", "Configuration & master data"];
    case "audit":
      return ["Audit Log", "System activity & data changes"];
    case "masterData":
      return ["Master Data", "Manage stores, farmers, users & reference lists"];
    case "campaigns":
      return ["Campaigns", "Segmented customer targeting & outreach"];
    case "products":
      return ["Product Catalog", "All products sold · categories, pricing & sales"];
    case "movement":
      return ["Stock / Movement", "Product velocity & demand signal across stores"];
    default:
      return ["Dashboard", ""];
  }
}
