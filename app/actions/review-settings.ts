"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getActor } from "@/lib/scope";
import { logAudit } from "@/lib/audit";
import { checkEmail } from "@/lib/email-validate";
import { emailConfig, emailLayout, esc, sendEmail, appUrl } from "@/lib/email";
import { getReviewSettings, REVIEW_SETTING_KEYS, type ReviewSettings } from "@/lib/review-settings";

/** Settings → "Reviews & Reports". System Admin only (the real admin, even while viewing as a role). */
async function requireAdmin(): Promise<boolean> {
  return !!(await getSession())?.isAdmin;
}

export interface EmailLogRow { id: number; at: string; to: string; subject: string; type: string; ok: boolean; error: string }
export interface RecipientCoverage { role: string; total: number; reachable: number }
export interface ReviewSettingsState {
  settings: ReviewSettings;
  email: { ready: boolean; missing: string[]; from: string; replyTo: string; appUrl: string };
  coverage: RecipientCoverage[];
  logs: EmailLogRow[];
  myEmail: string;
}

const ROLE_ROWS: [string, "REGIONAL" | "CENTRAL" | "SYSADMIN"][] = [["Regional Managers", "REGIONAL"], ["Central team", "CENTRAL"], ["System Admins", "SYSADMIN"]];

export async function getReviewSettingsState(): Promise<ReviewSettingsState | null> {
  if (!(await requireAdmin())) return null;
  const cfg = emailConfig();
  const [settings, users, logs, me] = await Promise.all([
    getReviewSettings(),
    prisma.user.findMany({
      where: { active: true, approvalStatus: "APPROVED", role: { in: ["REGIONAL", "CENTRAL", "SYSADMIN"] } },
      select: { role: true, workEmail: true },
    }).catch(() => []),
    prisma.emailLog.findMany({ orderBy: { id: "desc" }, take: 25 }).catch(() => []),
    getActor().then((a) => (a.userId ? prisma.user.findUnique({ where: { id: a.userId }, select: { workEmail: true } }) : null)).catch(() => null),
  ]);
  const coverage = ROLE_ROWS.map(([label, role]) => {
    const list = users.filter((u) => u.role === role);
    return { role: label, total: list.length, reachable: list.filter((u) => { const c = checkEmail(u.workEmail); return c.ok && !!c.normalized; }).length };
  });
  return {
    settings,
    email: { ready: cfg.ready, missing: cfg.missing, from: cfg.from, replyTo: cfg.replyTo, appUrl: appUrl("") },
    coverage,
    logs: logs.map((l) => ({
      id: l.id,
      at: l.createdAt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }),
      to: l.to, subject: l.subject, type: l.type, ok: l.ok, error: l.error ?? "",
    })),
    myEmail: me?.workEmail ?? "",
  };
}

export async function saveReviewSettings(input: ReviewSettings): Promise<{ ok: boolean; error?: string }> {
  if (!(await requireAdmin())) return { ok: false, error: "Not authorised." };
  const int = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
  if (!int(input.slaHours, 1, 24 * 30)) return { ok: false, error: "SLA must be 1–720 hours." };
  if (![input.weekStartDay, input.reportDay].every((d) => int(d, 0, 6))) return { ok: false, error: "Pick a valid day." };
  if (![input.reportHour, input.digestHour].every((h) => int(h, 0, 23))) return { ok: false, error: "Pick a valid hour." };
  if (input.emailEnabled && !emailConfig().ready) return { ok: false, error: `Email can't be switched on yet — missing ${emailConfig().missing.join(", ")} in the server environment.` };

  const before = await getReviewSettings();
  const pairs: [string, string][] = [
    [REVIEW_SETTING_KEYS.slaHours, String(input.slaHours)],
    [REVIEW_SETTING_KEYS.weekStartDay, String(input.weekStartDay)],
    [REVIEW_SETTING_KEYS.reportDay, String(input.reportDay)],
    [REVIEW_SETTING_KEYS.reportHour, String(input.reportHour)],
    [REVIEW_SETTING_KEYS.digestHour, String(input.digestHour)],
    [REVIEW_SETTING_KEYS.emailEnabled, input.emailEnabled ? "true" : "false"],
  ];
  try {
    await prisma.$transaction(pairs.map(([key, value]) => prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } })));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
  const changed = (Object.keys(input) as (keyof ReviewSettings)[]).filter((k) => input[k] !== before[k]).map((k) => `${k}: ${before[k]} → ${input[k]}`);
  if (changed.length) await logAudit("Setting", "CONFIG", `Reviews & Reports: ${changed.join(", ")}`);
  revalidatePath("/settings");
  revalidatePath("/visit-reviews");
  return { ok: true };
}

/** Send one test email (ignores the on/off switch, so you can verify the setup before enabling). */
export async function sendTestEmail(to: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await requireAdmin())) return { ok: false, error: "Not authorised." };
  const chk = checkEmail(to);
  if (!chk.ok || !chk.normalized) return { ok: false, error: chk.error ?? "Enter an email address." };
  const actor = await getActor();
  const html = emailLayout({
    title: "Field360 email is working ✓",
    preheader: "Test email from Field360 settings",
    bodyHtml: `<p style="margin:0 0 10px">This is a test sent by <b>${esc(actor.name)}</b> from Settings → Reviews &amp; Reports.</p>
<p style="margin:0">If it reached your inbox (not spam), the sending domain is set up correctly. In Gmail, open <b>⋮ → Show original</b> and check SPF, DKIM and DMARC all say <b>PASS</b>.</p>`,
    cta: { label: "Open Field360", href: appUrl("/visit-reviews") },
  });
  const res = await sendEmail({ to: chk.normalized, subject: "Field360 test email", html, type: "TEST", sentByName: actor.name, force: true });
  revalidatePath("/settings");
  return res.ok ? { ok: true } : { ok: false, error: res.error ?? "Send failed." };
}
