"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { checkEmail } from "@/lib/email-validate";
import { logAudit } from "@/lib/audit";
import { restampStatements, findOrphanCodes, type OrphanCode } from "@/lib/employee-codes";
import { shortStoreName } from "@/lib/store-utils";
import {
  KEY_TO_PRISMA,
  ROLE_GRAD,
  ROLE_ORDER,
  roleLabel,
  type RoleKey,
} from "@/lib/roles";

async function requireAdmin() {
  const s = await getSession();
  if (!s?.isAdmin) throw new Error("Not authorized");
  return s;
}

function isRoleKey(k: string): k is RoleKey {
  return (ROLE_ORDER as string[]).includes(k);
}

const initialsOf = (name: string) =>
  name.split(" ").map((w) => w[0]).filter(Boolean).join("").slice(0, 2).toUpperCase() || "NA";

/* ─────────────── Pending approvals ─────────────── */

/** Approve a pending registration and assign a role. */
export async function approveUserAction(id: number, roleKey: string) {
  await requireAdmin();
  if (!isRoleKey(roleKey)) return;
  const [gradA, gradB] = ROLE_GRAD[roleKey];
  await prisma.user.update({
    where: { id },
    data: {
      approvalStatus: "APPROVED",
      role: KEY_TO_PRISMA[roleKey] as never,
      roleLabel: roleLabel(roleKey),
      gradA,
      gradB,
      active: true,
      lastActive: "Approved",
    },
  });
  revalidatePath("/users");
}

/** Decline a pending registration. */
export async function rejectUserAction(id: number) {
  await requireAdmin();
  await prisma.user.update({
    where: { id },
    data: { approvalStatus: "REJECTED", active: false },
  });
  revalidatePath("/users");
}

/** Change an approved user's role. */
export async function setUserRoleAction(id: number, roleKey: string) {
  await requireAdmin();
  if (!isRoleKey(roleKey)) return;
  const [gradA, gradB] = ROLE_GRAD[roleKey];
  await prisma.user.update({
    where: { id },
    data: {
      role: KEY_TO_PRISMA[roleKey] as never,
      roleLabel: roleLabel(roleKey),
      gradA,
      gradB,
    },
  });
  revalidatePath("/users");
}

/** Activate / deactivate a user. */
export async function setUserActiveAction(id: number, active: boolean) {
  await requireAdmin();
  await prisma.user.update({ where: { id }, data: { active } });
  revalidatePath("/users");
}

/* ─────────────── Create / Edit / Delete (System Admin) ─────────────── */

export interface UserFormInput {
  employeeCode: string;
  name: string;
  roleKey: string;
  mobile: string;
  workEmail: string;
  territory: string;
  active: boolean;
  /** New/reset password. Blank on create → their mobile; blank on edit → keep current. */
  password: string;
}

/**
 * Validate a Work email (it's where review digests / reports are sent). Blank is fine. Rejects broken,
 * placeholder (noemail@…) and typo-domain (gamil.com) addresses, and an address already on another user
 * — a shared address would send one person's reports to someone else. Returns the normalised value.
 */
async function validateWorkEmail(raw: string, selfId?: number): Promise<{ ok: true; value: string | null } | { ok: false; error: string }> {
  const chk = checkEmail(raw);
  if (!chk.ok) return { ok: false, error: `Work email: ${chk.error}${chk.suggestion ? ` Did you mean ${chk.suggestion}?` : ""}` };
  if (!chk.normalized) return { ok: true, value: null };
  const dup = await prisma.user.findFirst({
    where: { workEmail: { equals: chk.normalized, mode: "insensitive" }, ...(selfId ? { NOT: { id: selfId } } : {}) },
    select: { name: true, employeeCode: true },
  });
  if (dup) return { ok: false, error: `Work email ${chk.normalized} is already on ${dup.name}${dup.employeeCode ? ` (${dup.employeeCode})` : ""}. Each person needs their own address.` };
  return { ok: true, value: chk.normalized };
}

/** Create a login-ready account (approved, forced password change on first login). */
export async function createUserAction(
  input: UserFormInput,
): Promise<{ ok: boolean; id?: number; error?: string }> {
  await requireAdmin();
  const code = input.employeeCode.trim().toUpperCase();
  const name = input.name.trim();
  if (!code) return { ok: false, error: "Employee code is required." };
  if (!name) return { ok: false, error: "Name is required." };
  if (!isRoleKey(input.roleKey)) return { ok: false, error: "Select a role." };
  const key = input.roleKey;
  const mobile = input.mobile.replace(/\D/g, "");
  try {
    const clash = await prisma.user.findUnique({ where: { employeeCode: code }, select: { id: true, name: true, active: true } });
    if (clash) return { ok: false, error: clash.active
      ? `Employee code ${code} already exists (${clash.name}).`
      : `Employee code ${code} belongs to a deactivated account (${clash.name}). Find them in the Users list (set the status filter to Inactive), then reactivate and edit that account instead of creating a new one.` };
    const em = await validateWorkEmail(input.workEmail);
    if (!em.ok) return { ok: false, error: em.error };
    const [gradA, gradB] = ROLE_GRAD[key];
    const passwordHash = await bcrypt.hash(input.password.trim() || mobile || "uaagro@123", 10);
    const created = await prisma.user.create({
      data: {
        employeeCode: code,
        name,
        role: KEY_TO_PRISMA[key] as never,
        roleLabel: roleLabel(key),
        initials: initialsOf(name),
        gradA,
        gradB,
        mobile: mobile || null,
        workEmail: em.value,
        territory: input.territory.trim() || null,
        passwordHash,
        mustChangePassword: true,
        approvalStatus: "APPROVED",
        active: input.active,
        source: "REAL",
        lastActive: "Just added",
      },
      select: { id: true },
    });
    revalidatePath("/users");
    return { ok: true, id: created.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Create failed" };
  }
}

// The employee-code columns + re-stamp live in lib/employee-codes.ts (shared with the orphan-code check).

/** Update an existing user's details (System-Admin edit modal). */
export async function saveUser(
  input: UserFormInput & { id: number },
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const code = input.employeeCode.trim().toUpperCase();
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required." };
  try {
    const existing = await prisma.user.findUnique({ where: { id: input.id }, select: { employeeCode: true, name: true } });
    const oldCode = existing?.employeeCode ?? null;
    // Code changed temp→permanent: carry this user's existing attribution across to the new code.
    const migrateCode = !!(code && oldCode && oldCode !== code);
    if (code) {
      const clash = await prisma.user.findFirst({
        where: { employeeCode: code, NOT: { id: input.id } },
        select: { id: true, name: true, active: true },
      });
      if (clash) return { ok: false, error: clash.active
        ? `Employee code ${code} is already used by someone else (${clash.name}).`
        : `Employee code ${code} belongs to a deactivated account (${clash.name}). Reactivate that account instead of reusing the code here.` };
    }
    const em = await validateWorkEmail(input.workEmail, input.id);
    if (!em.ok) return { ok: false, error: em.error };
    const data: Prisma.UserUpdateInput = {
      name,
      employeeCode: code || null,
      mobile: input.mobile.replace(/\D/g, "") || null,
      workEmail: em.value,
      territory: input.territory.trim() || null,
      active: input.active,
      // Reactivating here must also clear a REJECTED approval flag — login refuses REJECTED accounts
      // regardless of `active`, so without this a reactivated rejected account still couldn't sign in.
      ...(input.active ? { approvalStatus: "APPROVED" as const } : {}),
    };
    if (isRoleKey(input.roleKey)) {
      const [gradA, gradB] = ROLE_GRAD[input.roleKey];
      data.role = KEY_TO_PRISMA[input.roleKey] as never;
      data.roleLabel = roleLabel(input.roleKey);
      data.gradA = gradA;
      data.gradB = gradB;
    }
    if (input.password.trim()) {
      data.passwordHash = await bcrypt.hash(input.password.trim(), 10);
      data.mustChangePassword = true;
    }
    await prisma.$transaction([
      prisma.user.update({ where: { id: input.id }, data }),
      ...(migrateCode ? restampStatements(oldCode!, code) : []),
    ]);
    if (migrateCode) await logAudit("User", "UPDATE", `Employee code changed ${oldCode} → ${code} for ${existing?.name ?? name}; their visits, follow-ups, comments and campaign records moved to the new code`);
    revalidatePath("/users");
    if (migrateCode) { revalidatePath("/action-registry"); revalidatePath("/visits"); }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed" };
  }
}

/** Permanently delete a user account (can't delete yourself). */
export async function deleteUserAction(id: number): Promise<{ ok: boolean; error?: string }> {
  const s = await requireAdmin();
  if (s.userId === id) return { ok: false, error: "You can't delete your own account." };
  try {
    await prisma.user.delete({ where: { id } });
    revalidatePath("/users");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed" };
  }
}

export interface UserActivityRow { id: number; ts: string; action: string; entity: string; detail: string; ip: string }

/**
 * Recent audit-trail entries attributed to an employee (matched by actor name — the AuditLog is
 * keyed by actor name, not user id). Returns [] when none are recorded. NB: granular login history
 * is not captured by the current AuditLog schema — only actions that write an AuditLog row appear.
 */
export async function getUserActivity(actorName: string): Promise<UserActivityRow[]> {
  const name = actorName?.trim();
  if (!name) return [];
  try {
    const logs = await prisma.auditLog.findMany({
      where: { actor: { equals: name, mode: "insensitive" } },
      orderBy: { createdAt: "desc" },
      take: 40,
    });
    return logs.map((l) => ({
      id: l.id,
      ts: l.displayTs ?? l.createdAt.toISOString().slice(0, 16).replace("T", " "),
      action: l.action,
      entity: l.entity ?? "",
      detail: l.detail ?? "",
      ip: l.ip ?? "",
    }));
  } catch {
    return [];
  }
}

/* ─────────────── Lost employee codes (records under a code no account has) ─────────────── */
export interface OrphanCodeVM extends OrphanCode {
  storeNames: string[];
  suggestions: { id: number; name: string; code: string; store: string; sameStore: boolean; active: boolean }[];
}
export interface CodeOwnerOption { id: number; name: string; code: string; store: string; active: boolean }

/** Codes stamped on visits / follow-ups / campaign records that match no user — with the likely owner. */
export async function listOrphanCodes(): Promise<{ orphans: OrphanCodeVM[]; users: CodeOwnerOption[] }> {
  await requireAdmin();
  const [orphans, users, stores] = await Promise.all([
    findOrphanCodes(),
    prisma.user.findMany({ where: { employeeCode: { not: null } }, select: { id: true, name: true, employeeCode: true, storeId: true, active: true }, orderBy: { name: "asc" } }),
    prisma.store.findMany({ select: { id: true, name: true } }),
  ]);
  const sName = new Map(stores.map((s) => [s.id, shortStoreName(s.name) || s.name]));
  const norm = (x: string) => x.trim().toLowerCase().replace(/\s+/g, " ");
  return {
    orphans: orphans.map((o) => {
      const names = new Set(o.names.map(norm));
      const suggestions = users
        .filter((u) => names.has(norm(u.name)))
        .map((u) => ({ id: u.id, name: u.name, code: u.employeeCode!, store: u.storeId != null ? sName.get(u.storeId) ?? "" : "", sameStore: u.storeId != null && o.storeIds.includes(u.storeId), active: u.active }))
        .sort((a, b) => Number(b.sameStore) - Number(a.sameStore) || Number(b.active) - Number(a.active));
      return { ...o, storeNames: o.storeIds.map((id) => sName.get(id) ?? `#${id}`), suggestions };
    }),
    users: users.map((u) => ({ id: u.id, name: u.name, code: u.employeeCode!, store: u.storeId != null ? sName.get(u.storeId) ?? "" : "", active: u.active })),
  };
}

/** Move every record stamped with a lost code onto a user's current code (so they own them again). */
export async function reassignOrphanCode(oldCode: string, userId: number): Promise<{ ok: boolean; moved?: number; error?: string }> {
  await requireAdmin();
  const from = (oldCode ?? "").trim().toUpperCase();
  if (!from) return { ok: false, error: "No code given." };
  const [taken, target] = await Promise.all([
    prisma.user.findFirst({ where: { employeeCode: from }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, employeeCode: true } }),
  ]);
  if (taken) return { ok: false, error: `${from} belongs to ${taken.name} — it isn't a lost code.` };
  if (!target?.employeeCode) return { ok: false, error: "Pick a user who has an employee code." };
  try {
    const counts = await prisma.$transaction(restampStatements(from, target.employeeCode));
    const moved = counts.reduce((s, n) => s + Number(n), 0);
    await logAudit("User", "UPDATE", `Lost employee code ${from} re-assigned to ${target.name} (${target.employeeCode}) — ${moved} records moved`);
    revalidatePath("/users"); revalidatePath("/action-registry"); revalidatePath("/visits");
    return { ok: true, moved };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Re-assign failed" };
  }
}
