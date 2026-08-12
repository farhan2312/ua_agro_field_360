/**
 * WhatsApp Cloud API client (server-only). Meta Graph API — https://developers.facebook.com/docs/whatsapp/cloud-api
 *
 * Config comes entirely from env so you only ever edit .env, never code:
 *   WHATSAPP_ACCESS_TOKEN    — System User permanent token (auth)          [required]
 *   WHATSAPP_PHONE_NUMBER_ID — sender phone number id (NOT the number)     [required]
 *   WHATSAPP_API_VERSION     — Graph API version                          [optional — default below]
 *   WHATSAPP_WABA_ID         — WhatsApp Business Account id                [optional — not needed to send]
 *
 * Two send modes:
 *   • text     — a plain text message. Only delivered to numbers that messaged you in the last 24h
 *                or your app's registered test numbers (Meta's session-message rule).
 *   • template — a pre-approved template by name + language. Required for cold / business-initiated
 *                outreach; the approved template's body variables are filled from `bodyParams`.
 */

const DEFAULT_VERSION = "v21.0";

export interface WaConfig {
  accessToken: string; phoneNumberId: string; version: string; wabaId: string;
}

// Trim whitespace AND strip one layer of wrapping quotes — a token pasted as "EAAG…" (quotes included)
// is a very common cause of Meta "Authentication Error" (the quotes travel in the Bearer header).
const clean = (v: string | undefined) => (v ?? "").trim().replace(/^['"]|['"]$/g, "").trim();

/** Read + validate env config. `missing` lists which REQUIRED keys are blank. */
export function waConfig(): { cfg: WaConfig; ready: boolean; missing: string[] } {
  const cfg: WaConfig = {
    accessToken: clean(process.env.WHATSAPP_ACCESS_TOKEN),
    phoneNumberId: clean(process.env.WHATSAPP_PHONE_NUMBER_ID),
    version: clean(process.env.WHATSAPP_API_VERSION) || DEFAULT_VERSION,
    wabaId: clean(process.env.WHATSAPP_WABA_ID),
  };
  const missing = (Object.entries({
    WHATSAPP_ACCESS_TOKEN: cfg.accessToken, WHATSAPP_PHONE_NUMBER_ID: cfg.phoneNumberId,
  }) as [string, string][]).filter(([, v]) => !v).map(([k]) => k);
  return { cfg, ready: missing.length === 0, missing };
}

export interface WaResult {
  ok: boolean;
  providerId?: string; // wamid.* message id
  status?: string;
  raw?: string;
  error?: string;
}

/** Normalise to E.164 digits with the India country code (gateway wants the full number, no +). */
function normalizeMobile(mobile: string): string | null {
  const d = mobile.replace(/\D/g, "").replace(/^0+/, "");
  if (d.length < 10) return null;
  return d.length === 10 ? `91${d}` : d;
}

/**
 * Send one WhatsApp message. Provide `templateName` (+ `languageCode`, optional `bodyParams`) for a
 * template send, otherwise `message` is sent as plain text. Returns a normalized result; never throws.
 */
export async function sendWhatsApp(opts: {
  mobile: string;
  message?: string;
  templateName?: string | null;
  languageCode?: string | null;
  bodyParams?: string[];
}): Promise<WaResult> {
  const { cfg, ready, missing } = waConfig();
  if (!ready) return { ok: false, error: `WhatsApp not configured — set ${missing.join(", ")} in the environment.` };

  const to = normalizeMobile(opts.mobile);
  if (!to) return { ok: false, error: "Invalid mobile number." };

  const isTemplate = !!opts.templateName;
  if (!isTemplate && !(opts.message ?? "").trim()) return { ok: false, error: "Message is empty." };

  const payload: Record<string, unknown> = { messaging_product: "whatsapp", recipient_type: "individual", to };
  if (isTemplate) {
    const components = opts.bodyParams && opts.bodyParams.length
      ? [{ type: "body", parameters: opts.bodyParams.map((t) => ({ type: "text", text: t })) }]
      : [];
    payload.type = "template";
    payload.template = {
      name: opts.templateName,
      language: { code: (opts.languageCode || "en").trim() },
      ...(components.length ? { components } : {}),
    };
  } else {
    payload.type = "text";
    payload.text = { preview_url: false, body: opts.message };
  }

  try {
    const res = await fetch(`https://graph.facebook.com/${cfg.version}/${cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const raw = (await res.text()).slice(0, 2000);
    let body: unknown = null;
    try { body = JSON.parse(raw); } catch { /* non-JSON */ }
    const b = (body ?? {}) as Record<string, unknown>;
    const err = b.error as Record<string, unknown> | undefined;
    const messages = Array.isArray(b.messages) ? (b.messages as Record<string, unknown>[]) : [];
    const providerId = String(messages[0]?.id ?? "") || undefined;
    const ok = res.ok && !err && !!providerId;

    // Meta returns { error: { message, code, error_subcode, error_data: { details }, error_user_msg } }.
    // Surface the code + detail so the failure is actionable (e.g. 190 = bad/expired token).
    let detail = "";
    if (err) {
      const ed = (err.error_data ?? {}) as Record<string, unknown>;
      const bits = [
        err.message ? String(err.message) : "",
        err.code != null ? `code ${err.code}${err.error_subcode != null ? `/${err.error_subcode}` : ""}` : "",
        ed.details ? String(ed.details) : err.error_user_msg ? String(err.error_user_msg) : "",
      ].filter(Boolean);
      detail = bits.join(" · ");
    }

    return {
      ok,
      providerId,
      status: ok ? "Sent" : detail || `HTTP ${res.status}`,
      raw,
      error: ok ? undefined : detail || `Gateway returned ${res.status}`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error contacting WhatsApp." };
  }
}
