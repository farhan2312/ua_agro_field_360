import { canAccess, type RoleKey } from "./roles";

export type NavId =
  | "dashboard" | "newVisit" | "visitRepo" | "farmers" | "mapView"
  | "farmerCluster" | "masterData" | "analytics" | "leads" | "actions"
  | "users" | "settings" | "audit";

/** A "view" can also be a detail variant of a nav id (for header titles). */
export type ViewId = NavId | "farmerDetail" | "visitDetail" | "projectDetail";

export interface NavItem {
  id: NavId;
  label: string;
  href: string;
}

export const MAIN_NAV: NavItem[] = [
  { id: "dashboard", label: "Dashboard", href: "/dashboard" },
  { id: "newVisit", label: "New Visit", href: "/visits/new" },
  { id: "visitRepo", label: "Visit Repo", href: "/visits" },
  { id: "farmers", label: "Farmer 360", href: "/farmers" },
  { id: "mapView", label: "Cluster Builder", href: "/map" },
  { id: "farmerCluster", label: "Farmer Clusters", href: "/clusters" },
  { id: "masterData", label: "Master Data", href: "/master-data" },
  { id: "analytics", label: "Analytics", href: "/analytics" },
  { id: "leads", label: "Lead Pipeline", href: "/leads" },
  { id: "actions", label: "Action Planner", href: "/actions" },
];

export const ADMIN_NAV: NavItem[] = [
  { id: "users", label: "Users", href: "/users" },
  { id: "settings", label: "Settings", href: "/settings" },
  { id: "audit", label: "Audit Log", href: "/audit" },
];

/** Nav items visible to a role (RBAC). */
export function visibleNav(role: RoleKey) {
  return {
    main: MAIN_NAV.filter((n) => canAccess(n.id, role)),
    admin: ADMIN_NAV.filter((n) => canAccess(n.id, role)),
    showAdminGroup: ADMIN_NAV.some((n) => canAccess(n.id, role)),
  };
}

const ALL_HREFS = [...MAIN_NAV, ...ADMIN_NAV].map((n) => n.href);

/** The nav href that should appear active for a given pathname (longest prefix wins). */
export function activeNavHref(pathname: string): string | null {
  let best: string | null = null;
  for (const href of ALL_HREFS) {
    if (pathname === href || pathname.startsWith(href + "/") || pathname.startsWith(href)) {
      if (!best || href.length > best.length) best = href;
    }
  }
  // /visits/new must beat /visits; longest-prefix handles it, but guard exact /visits/<id>
  return best;
}

/** Map a pathname to a view id (drives header title/subtitle). */
export function routeToView(pathname: string): ViewId {
  if (pathname.startsWith("/visits/new")) return "newVisit";
  if (/^\/visits\/[^/]+/.test(pathname)) return "visitDetail";
  if (pathname.startsWith("/visits")) return "visitRepo";
  if (/^\/farmers\/[^/]+/.test(pathname)) return "farmerDetail";
  if (pathname.startsWith("/farmers")) return "farmers";
  if (/^\/actions\/[^/]+/.test(pathname)) return "projectDetail";
  if (pathname.startsWith("/actions")) return "actions";
  if (pathname.startsWith("/map")) return "mapView";
  if (pathname.startsWith("/clusters")) return "farmerCluster";
  if (pathname.startsWith("/master-data")) return "masterData";
  if (pathname.startsWith("/analytics")) return "analytics";
  if (pathname.startsWith("/leads")) return "leads";
  if (pathname.startsWith("/users")) return "users";
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/audit")) return "audit";
  return "dashboard";
}
