"use server";

import { getScope, canManage } from "@/lib/scope";
import { waListTemplates, waCreateTemplate, waDeleteTemplate, waConfig, type WaTemplate } from "@/lib/whatsapp";

async function adminOnly(): Promise<boolean> {
  const { role } = await getScope();
  return canManage(role);
}

export type { WaTemplate };

/** Whether template management is possible (token + WABA id present). */
export async function waTemplatesStatus(): Promise<{ ready: boolean; missing: string[] }> {
  const { ready, missing, cfg } = waConfig();
  const m = [...missing];
  if (!cfg.wabaId) m.push("WHATSAPP_WABA_ID");
  return { ready: ready && !!cfg.wabaId, missing: m };
}

export async function listTemplates(): Promise<{ ok: boolean; templates?: WaTemplate[]; error?: string }> {
  if (!(await adminOnly())) return { ok: false, error: "Admins only." };
  return waListTemplates();
}

export async function createTemplate(input: {
  name: string; language: string; category: string; body: string; examples?: string[];
}): Promise<{ ok: boolean; id?: string; status?: string; error?: string }> {
  if (!(await adminOnly())) return { ok: false, error: "Admins only." };
  return waCreateTemplate(input);
}

export async function deleteTemplate(name: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await adminOnly())) return { ok: false, error: "Admins only." };
  return waDeleteTemplate(name);
}
