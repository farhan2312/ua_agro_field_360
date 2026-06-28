import { cookies } from "next/headers";
import { PERSONAS, ROLE_ORDER, type RoleKey, type Persona } from "./roles";

export const ROLE_COOKIE = "ua_role";

/** Current role from cookie (defaults to 'regional'). Server-only. */
export function getRole(): RoleKey {
  const v = cookies().get(ROLE_COOKIE)?.value as RoleKey | undefined;
  return v && (ROLE_ORDER as string[]).includes(v) ? v : "regional";
}

export function getPersona(): Persona {
  return PERSONAS[getRole()];
}
