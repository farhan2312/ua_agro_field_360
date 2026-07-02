"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
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
}

function isRoleKey(k: string): k is RoleKey {
  return (ROLE_ORDER as string[]).includes(k);
}

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

/** Save the editable fields of a user (System-Admin Edit modal). */
export async function saveUser(input: {
  id: number;
  name: string;
  roleLabel: string;
  territory: string;
  active: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.user.update({
      where: { id: input.id },
      data: {
        name: input.name.trim(),
        roleLabel: input.roleLabel.trim() || null,
        territory: input.territory.trim() || null,
        active: input.active,
      },
    });
    revalidatePath("/users");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed" };
  }
}
