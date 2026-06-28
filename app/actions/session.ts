"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ROLE_COOKIE } from "@/lib/session";
import { ROLE_ORDER, type RoleKey } from "@/lib/roles";

/** Switch the active persona (demo role switcher). Persists in a cookie. */
export async function setRoleAction(role: RoleKey) {
  if (!(ROLE_ORDER as string[]).includes(role)) return;
  cookies().set(ROLE_COOKIE, role, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
}
