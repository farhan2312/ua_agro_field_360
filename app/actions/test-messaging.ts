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
  message: string;
  farmerId?: number | null;
}): Promise<TestSmsResult> {
  if (!(await adminOnly())) return { ok: false, error: "Test WhatsApp is available to admins only." };

  const mobile = (input.mobile ?? "").replace(/\D/g, "");
  if (!/^[6-9]\d{9}$/.test(mobile)) return { ok: false, error: "Enter a valid 10-digit mobile number (starts 6–9)." };
  const message = (input.message ?? "").trim();
  if (!message) return { ok: false, error: "Message is empty." };

  const { ready, missing } = waConfig();
  if (!ready) return { ok: false, error: `WhatsApp not configured — set ${missing.join(", ")} in the environment.` };

  try {
    const actor = await getActor();
    const res = await sendWhatsApp({ mobile, message });
    await prisma.whatsAppLog.create({
      data: {
        farmerId: input.farmerId ?? null, mobile, kind: "text", message,
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
