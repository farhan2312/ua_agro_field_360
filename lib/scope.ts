/**
 * Data-access scope for the current user. Central/Sysadmin see everything and may
 * create/extend projects & campaigns. Officers are scoped to their store; Regional
 * Managers to their zone (region). Used by the campaign server actions.
 */
import type { Prisma } from "@prisma/client";
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

/**
 * Row-level scope fragments. `null` = unrestricted (central/sysadmin); `"none"` = show
 * nothing (a scoped user with no store/region assigned — fail CLOSED, never open).
 *
 * Region is taken from the STORE, never `Farmer.zone`: 23k+ farmers carry a zone that
 * disagrees with their store's, and 24k have none at all, so the store is authoritative.
 * Callers must AND these on LAST, after any user-supplied filters, so a crafted query
 * string can never widen them.
 */
export type Scoped<W> = W | "none" | null;

export function farmerScopeWhere(scope: Scope): Scoped<Prisma.FarmerWhereInput> {
  if (scope.role === "campaigner") return "none"; // call team has no farmer-directory access — fail closed
  if (scope.role === "officer") return scope.storeId != null ? { storeId: scope.storeId } : "none";
  if (scope.role === "regional") return scope.zone ? { store: { zone: scope.zone } } : "none";
  return null;
}

export function storeScopeWhere(scope: Scope): Scoped<Prisma.StoreWhereInput> {
  if (scope.role === "campaigner") return "none";
  if (scope.role === "officer") return scope.storeId != null ? { id: scope.storeId } : "none";
  if (scope.role === "regional") return scope.zone ? { zone: scope.zone } : "none";
  return null;
}

/**
 * Visits use their own `storeId` when set, else fall back to the farmer's store —
 * visits recorded through the wizard currently persist a null storeId, and those
 * still belong to the farmer's store for access purposes.
 */
export function visitScopeWhere(scope: Scope): Scoped<Prisma.VisitWhereInput> {
  if (scope.role === "campaigner") return "none";
  if (scope.role === "officer") {
    if (scope.storeId == null) return "none";
    return { OR: [{ storeId: scope.storeId }, { storeId: null, farmer: { storeId: scope.storeId } }] };
  }
  if (scope.role === "regional") {
    if (!scope.zone) return "none";
    return { OR: [{ store: { zone: scope.zone } }, { storeId: null, farmer: { store: { zone: scope.zone } } }] };
  }
  return null;
}

/**
 * Ghoshti (farmer meetup) row-level scope. Ghoshtis carry a snapshot `storeId` + `zone` (no relation),
 * so scoping keys off those columns directly. Officer → own store; RM → own zone; central/sysadmin → all.
 */
export function ghoshtiScopeWhere(scope: Scope): Scoped<Prisma.GhoshtiWhereInput> {
  if (scope.role === "campaigner") return "none";
  if (scope.role === "officer") return scope.storeId != null ? { storeId: scope.storeId } : "none";
  if (scope.role === "regional") return scope.zone ? { zone: scope.zone } : "none";
  return null;
}

/**
 * Whether `scope` may approve/reject a Ghoshti created under `createdByRole` in `zone`.
 * Officer-created → RM of the SAME zone, or any central/sysadmin. RM-created → central/sysadmin only.
 * Nobody may approve their own creation implicitly here — callers still block self-approval by userId.
 */
export function canApproveGhoshti(
  scope: Scope,
  createdByRole: string | null | undefined,
  zone: string | null | undefined,
): boolean {
  if (scope.role === "central" || scope.role === "sysadmin") return true;
  if (createdByRole === "officer" && scope.role === "regional") {
    return !!scope.zone && scope.zone === zone;
  }
  return false;
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
