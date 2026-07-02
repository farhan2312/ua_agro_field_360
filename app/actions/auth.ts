"use server";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { signSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session-token";
import { ROLE_COOKIE } from "@/lib/session";
import {
  PRISMA_TO_KEY,
  KEY_TO_PRISMA,
  REQUESTABLE_ROLES,
  ROLE_GRAD,
  roleLabel,
  type RoleKey,
} from "@/lib/roles";
import { initials } from "@/lib/format";

export interface AuthResult {
  ok?: boolean;
  error?: string;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function loginAction(formData: FormData): Promise<AuthResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) return { error: "Invalid email or password." };
    if (user.approvalStatus === "PENDING")
      return { error: "Your account is awaiting admin approval." };
    if (user.approvalStatus === "REJECTED")
      return { error: "Your access request was declined. Contact the administrator." };
    if (!user.active) return { error: "This account has been deactivated." };

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) return { error: "Invalid email or password." };

    const roleKey = PRISMA_TO_KEY[user.role] ?? "officer";
    const token = await signSession({
      userId: user.id,
      name: user.name,
      email: user.email ?? email,
      roleKey,
      isAdmin: user.role === "SYSADMIN",
    });
    cookies().set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    // start each session at the user's own role (clear any stale impersonation)
    cookies().delete(ROLE_COOKIE);
    return { ok: true };
  } catch {
    return { error: "Something went wrong. Please try again." };
  }
}

export async function registerAction(formData: FormData): Promise<AuthResult> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const roleRaw = String(formData.get("role") ?? "officer") as RoleKey;

  if (!name || !email || !password) return { error: "All fields are required." };
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (password !== confirm) return { error: "Passwords do not match." };
  const roleKey: RoleKey = REQUESTABLE_ROLES.some((r) => r.key === roleRaw)
    ? roleRaw
    : "officer";

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return { error: "An account with this email already exists." };

    const [gradA, gradB] = ROLE_GRAD[roleKey];
    await prisma.user.create({
      data: {
        name,
        email,
        passwordHash: await hashPassword(password),
        role: KEY_TO_PRISMA[roleKey] as never,
        roleLabel: roleLabel(roleKey),
        initials: initials(name),
        gradA,
        gradB,
        approvalStatus: "PENDING",
        active: true,
        source: "REAL",
        lastActive: "Just registered",
        visitsMtd: "—",
      },
    });
    return { ok: true };
  } catch {
    return { error: "Could not create the account. Please try again." };
  }
}

export async function logoutAction(): Promise<void> {
  cookies().delete(SESSION_COOKIE);
  cookies().delete(ROLE_COOKIE);
}
