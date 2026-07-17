/**
 * Data-access scope for the current user. Central/Sysadmin see everything and may
 * create/extend projects & campaigns. Officers are scoped to their store; Regional
 * Managers to their zone (region). Used by the campaign server actions.
 */
import { getSession } from "./auth";
import { getRole } from "./session";
import { prisma } from "./prisma";
import type { RoleKey } from "./roles";

export interface Scope {
  role: RoleKey;
  userId: number | null;
  storeId: number | null; // officer's store
  zone: string | null; // regional manager's region
}

export async function getScope(): Promise<Scope> {
  const [role, session] = await Promise.all([getRole(), getSession()]);
  if (!session) return { role, userId: null, storeId: null, zone: null };
  const u = await prisma.user.findUnique({ where: { id: session.userId }, select: { storeId: true, zone: true } });
  return { role, userId: session.userId, storeId: u?.storeId ?? null, zone: u?.zone ?? null };
}

/** Central team + Sysadmin may create / extend / delete projects & campaigns. */
export function canManage(role: RoleKey): boolean {
  return role === "central" || role === "sysadmin";
}

export interface Actor {
  name: string;
  code: string | null; // User.employeeCode, e.g. "UA123"
  userId: number | null;
}

/**
 * Audit identity: the ACTUAL logged-in user (never the impersonated persona) —
 * recorded on visit forms and campaign-outreach marks alongside the timestamp.
 */
export async function getActor(): Promise<Actor> {
  const session = await getSession();
  if (!session) return { name: "Unknown", code: null, userId: null };
  const u = await prisma.user.findUnique({ where: { id: session.userId }, select: { name: true, employeeCode: true } });
  return { name: u?.name ?? "Unknown", code: u?.employeeCode ?? null, userId: session.userId };
}
