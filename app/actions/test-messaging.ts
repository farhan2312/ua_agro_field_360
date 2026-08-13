"use server";

import { prisma } from "@/lib/prisma";
import { getScope, canManage, getActor } from "@/lib/scope";
import { zapConfig, sendSms } from "@/lib/zapsms";
import { waConfig, sendWhatsApp } from "@/lib/whatsapp";

/** Admins / super admins only (Central Admin + System Admin). */
async function adminOnly(): Promise<boolean> {
  const { role } = await getScope();
  return canManage(role);
}

export interface TestSmsResult {
  ok: boolean;
  error?: string;
  providerId?: string;
  status?: string;
}

export interface WaLogRow {
  id: number; mobile: string; kind: string; status: string | null; error: string | null;
  ok: boolean; deliveredAt: string | null; readAt: string | null; createdAt: string;
}

/** Recent WhatsApp sends + their live delivery status (updated by Meta's status webhook). Admin-only. */
export async function getRecentWhatsAppLogs(limit = 8): Promise<WaLogRow[]> {
  if (!(await adminOnly())) return [];
  const rows = await prisma.whatsAppLog.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(25, limit) });
  return rows.map((r) => ({
    id: r.id, mobile: r.mobile, kind: r.kind, status: r.status, error: r.error, ok: r.ok,
    deliveredAt: r.deliveredAt?.toISOString() ?? null, readAt: r.readAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Fire a one-off test SMS to any number (a picked farmer or a typed-in mobile), straight through the
 * ZapSMS gateway. Not tied to a campaign — for verifying the gateway + credentials from Settings.
 * Admin-only, and every send is written to SmsLog like the campaign path.
 */
export async function sendTestSms(input: {
  mobile: string;
  message: string;
  commTemplateId?: number | null;
  farmerId?: number | null;
}): Promise<TestSmsResult> {
  if (!(await adminOnly())) return { ok: false, error: "Test SMS is available to admins only." };

  const mobile = (input.mobile ?? "").replace(/\D/g, "");
  if (!/^[6-9]\d{9}$/.test(mobile)) return { ok: false, error: "Enter a valid 10-digit mobile number (starts 6–9)." };
  const message = (input.message ?? "").trim();
  if (!message) return { ok: false, error: "Message is empty." };

  const { ready, missing, cfg } = zapConfig();
  if (!ready) return { ok: false, error: `SMS gateway not configured — set ${missing.join(", ")} in the environment.` };

  try {
    const tpl = input.commTemplateId
      ? await prisma.commTemplate.findUnique({ where: { id: input.commTemplateId }, select: { dltTemplateId: true } })
      : null;
    const actor = await getActor();
    const res = await sendSms({ mobile, message, dltTemplateId: tpl?.dltTemplateId ?? null });

    await prisma.smsLog.create({
      data: {
        farmerId: input.farmerId ?? null, mobile,
        senderId: cfg.senderId || null, dltTemplateId: tpl?.dltTemplateId ?? null, message,
        ok: res.ok, providerId: res.providerId ?? null,
        status: res.status ? `TEST · ${res.status}` : "TEST", error: res.error ?? null,
        sentByName: actor.name, sentByCode: actor.code,
      },
    });
    return { ok: res.ok, error: res.error, providerId: res.providerId, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Send failed." };
  }
}

/**
 * Fire a one-off test WhatsApp to any number via the Meta Cloud API. Free-form text — Meta only
 * delivers this to numbers that messaged you in the last 24h or your app's registered test numbers.
 * Admin-only; logged to WhatsAppLog.
 */
export async function sendTestWhatsApp(input: {
  mobile: string;
  message?: string;
  farmerId?: number | null;
  // Template mode (bypasses Meta's 24h session window — the reliable way to reach a cold number).
  templateName?: string | null;
  languageCode?: string | null;
  bodyParams?: string[];
}): Promise<TestSmsResult> {
  if (!(await adminOnly())) return { ok: false, error: "Test WhatsApp is available to admins only." };

  // WhatsApp test bench only: accept a full international number incl. country code (e.g. a UAE 971…
  // number) so an admin abroad can test. A bare 10-digit number is still treated as Indian downstream
  // (sendWhatsApp prefixes 91). SMS and the rest of the portal stay India-only.
  const mobile = (input.mobile ?? "").replace(/\D/g, "");
  if (!/^\d{8,15}$/.test(mobile)) return { ok: false, error: "Enter a valid international number incl. country code (8–15 digits, no +)." };

  const isTemplate = !!input.templateName;
  const message = (input.message ?? "").trim();
  if (!isTemplate && !message) return { ok: false, error: "Message is empty." };

  const { ready, missing } = waConfig();
  if (!ready) return { ok: false, error: `WhatsApp not configured — set ${missing.join(", ")} in the environment.` };

  try {
    const actor = await getActor();
    const res = isTemplate
      ? await sendWhatsApp({ mobile, templateName: input.templateName, languageCode: input.languageCode ?? "en", bodyParams: input.bodyParams ?? [] })
      : await sendWhatsApp({ mobile, message });
    // Log a readable summary for template sends (the actual text lives in the approved template).
    const logMsg = isTemplate
      ? `[template ${input.templateName}${input.bodyParams?.length ? ` · ${input.bodyParams.join(" | ")}` : ""}]`
      : message;
    await prisma.whatsAppLog.create({
      data: {
        farmerId: input.farmerId ?? null, mobile, kind: isTemplate ? "template" : "text",
        templateName: isTemplate ? input.templateName : null, message: logMsg,
        ok: res.ok, providerId: res.providerId ?? null,
        status: res.status ? `TEST · ${res.status}` : "TEST", error: res.error ?? null,
        sentByName: actor.name, sentByCode: actor.code,
      },
    });
    return { ok: res.ok, error: res.error, providerId: res.providerId, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Send failed." };
  }
}
