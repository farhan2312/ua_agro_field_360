"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { searchFarmersForAction } from "@/app/actions/action-registry";
import { sendTestSms, sendTestWhatsApp, getRecentWhatsAppLogs, getRecentSmsLogs, refreshSmsDeliveryStatus, smsBalance, type WaLogRow, type SmsLogRow } from "@/app/actions/test-messaging";
import { getSmsTemplates } from "@/app/actions/campaigns";
import type { SmsBalance } from "@/lib/zapsms";
import { fillPreview } from "@/lib/wa-template-presets";
import type { FarmerPick } from "@/lib/action-constants";

type Plan = { id: number; name: string; template: string; dltTemplateId: string | null; medium: string | null };
type WaTemplateOpt = { name: string; language: string; body: string; varCount: number };
type Channel = "sms" | "whatsapp";
type WaMode = "text" | "template";

/**
 * Settings → Test messaging bench. Pick a farmer (search) or type any number, compose a message
 * (free text, optionally loaded from a saved Comm Plan), and fire one SMS (ZapSMS) or WhatsApp
 * (Meta Cloud API). Admin-only (Settings is sysadmin); every send is logged.
 */
export function SmsTestCard({ plans, smsReady, missing, senderId, waReady, waMissing, waTemplates = [], only }: {
  plans: Plan[]; smsReady: boolean; missing: string[]; senderId: string;
  waReady: boolean; waMissing: string[]; waTemplates?: WaTemplateOpt[];
  only?: Channel; // lock to one channel + hide the toggle (SMS tab / WhatsApp tab)
}) {
  const [channel, setChannel] = useState<Channel>(only ?? "sms");
  const [waMode, setWaMode] = useState<WaMode>("text");
  const [tplName, setTplName] = useState<string>("");
  const [tplParams, setTplParams] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<FarmerPick[]>([]);
  const [picked, setPicked] = useState<FarmerPick | null>(null);
  const [mobile, setMobile] = useState("");
  const [planId, setPlanId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [sending, startSend] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const lastQ = useRef("");

  const isWa = channel === "whatsapp";
  const ready = isWa ? waReady : smsReady;
  const miss = isWa ? waMissing : missing;
  const accent = isWa ? "#0B8A3D" : "#6A1B9A";

  // Debounced farmer search.
  useEffect(() => {
    const term = q.trim();
    if (picked && term === picked.name) return;
    if (term.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      if (term === lastQ.current) return;
      lastQ.current = term;
      setResults(await searchFarmersForAction(term));
    }, 300);
    return () => clearTimeout(t);
  }, [q, picked]);

  const pick = (f: FarmerPick) => {
    setPicked(f); setResults([]); setQ(f.name);
    if (f.mobile) setMobile(f.mobile.replace(/\D/g, "").slice(-10));
  };
  const clearPick = () => { setPicked(null); setQ(""); };

  const loadPlan = (id: number | null) => {
    setPlanId(id);
    if (id == null) return;
    const p = plans.find((x) => x.id === id);
    if (p) setMessage(p.template || "");
  };

  // SMS is India-only (10 digits, 6–9). WhatsApp test allows a full international number incl. country
  // code (e.g. a UAE 971… number) — testing convenience only; the portal still serves India everywhere else.
  const mobileValid = isWa ? /^\d{8,15}$/.test(mobile) : /^[6-9]\d{9}$/.test(mobile);

  const isTemplateMode = isWa && waMode === "template";
  const selectedTpl = waTemplates.find((t) => t.name === tplName) ?? null;
  const paramsFilled = !selectedTpl || tplParams.slice(0, selectedTpl.varCount).filter((s) => s.trim()).length === selectedTpl.varCount;
  const pickTemplate = (name: string) => {
    setTplName(name);
    const t = waTemplates.find((x) => x.name === name);
    setTplParams(t ? Array(t.varCount).fill("") : []);
  };

  const canSend = ready && mobileValid && !sending && (
    isTemplateMode ? !!selectedTpl && paramsFilled : message.trim().length > 0
  );

  const [waLogs, setWaLogs] = useState<WaLogRow[] | null>(null);
  const refreshLogs = () => getRecentWhatsAppLogs(8).then(setWaLogs);
  const [bal, setBal] = useState<SmsBalance | null>(null);
  const loadBalance = () => smsBalance().then((r) => setBal(r.ok && r.balance ? r.balance : null));

  // Only SMS-medium comm plans belong in the SMS test loader (WhatsApp/Call plans use {{n}} and no DLT).
  const smsPlans = plans.filter((p) => (p.medium ?? "").toUpperCase().includes("SMS"));
  // Approved DLT template ids synced from ZapSMS — used to mark which comm plans are actually send-ready.
  const [approvedIds, setApprovedIds] = useState<Set<string> | null>(null);
  const loadApproved = () => getSmsTemplates().then((r) => setApprovedIds(new Set((r.templates ?? []).filter((t) => t.approved).map((t) => t.dltTemplateId))));
  // A comm plan's DLT readiness: no id / id-not-approved / approved / (approved-list not loaded yet).
  const dltState = (p: Plan): "none" | "unapproved" | "approved" | "unknown" => {
    const id = (p.dltTemplateId ?? "").trim();
    if (!id) return "none";
    if (approvedIds == null) return "unknown";
    return approvedIds.has(id) ? "approved" : "unapproved";
  };
  const DLT_MARK: Record<ReturnType<typeof dltState>, string> = { approved: "✓ DLT approved", unapproved: "⚠ DLT not approved", none: "⚠ no DLT id", unknown: "• DLT set" };
  const [smsLogs, setSmsLogs] = useState<SmsLogRow[] | null>(null);
  const [refreshingSms, startRefreshSms] = useTransition();
  const loadSmsLogs = () => getRecentSmsLogs(10).then(setSmsLogs);
  const refreshSmsStatus = () => startRefreshSms(async () => { const r = await refreshSmsDeliveryStatus(10); setSmsLogs(r.rows); });

  const send = () => {
    setResult(null);
    startSend(async () => {
      const r = isWa
        ? await sendTestWhatsApp(
            isTemplateMode && selectedTpl
              ? { mobile, templateName: selectedTpl.name, languageCode: selectedTpl.language, bodyParams: tplParams.slice(0, selectedTpl.varCount), farmerId: picked?.id ?? null }
              : { mobile, message, farmerId: picked?.id ?? null },
          )
        : await sendTestSms({ mobile, message, commTemplateId: planId, farmerId: picked?.id ?? null });
      setResult(r.ok
        ? {
            ok: true,
            text: isWa
              ? `Accepted by Meta${r.providerId ? ` · id ${r.providerId}` : ""}${r.status ? ` · ${r.status}` : ""} — watch delivery status below.`
              : `Submitted to the SMS gateway${r.providerId ? ` · id ${r.providerId}` : ""}${r.status ? ` · ${r.status}` : ""}.`,
          }
        : { ok: false, text: r.error ?? "Send failed." });
      if (isWa) { refreshLogs(); setTimeout(refreshLogs, 4000); } // status webhook lands a few seconds later
      else loadSmsLogs(); // SMS: show the new row immediately (DLR is pulled on demand)
    });
  };

  // Load the delivery log for whichever channel is active (+ SMS balance + approved-DLT sync).
  useEffect(() => { if (isWa) refreshLogs(); else { loadSmsLogs(); if (smsReady) { loadBalance(); loadApproved(); } } }, [isWa]); // eslint-disable-line

  const inputCls = "w-full rounded-[10px] border border-[#E0E0E0] px-3 py-2.5 text-[13px] outline-none focus:border-[#2E7D32]";

  return (
    <div className="rounded-2xl border border-black/[0.03] bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[15px] font-bold text-[#1A1C1A]">Test messaging</span>
        <span className="rounded-full px-2 py-0.5 text-[10.5px] font-bold" style={{ background: isWa ? "#E8F5E9" : "#F3E5F5", color: accent }}>{isWa ? "Meta WhatsApp" : "ZapSMS"}</span>
      </div>
      <p className="mb-3 text-[12px] text-[#9E9E9E]">Send a one-off message to a farmer or any number to verify the gateway. Admin-only; every send is logged.</p>

      {/* Channel toggle — hidden when the card is locked to one channel (SMS / WhatsApp tabs) */}
      {!only && (
        <div className="mb-4 inline-flex rounded-[10px] border border-[#E0E0E0] bg-[#F5F7F5] p-1">
          {([["sms", "✉ SMS"], ["whatsapp", "⚡ WhatsApp"]] as [Channel, string][]).map(([c, label]) => (
            <button key={c} type="button" onClick={() => { setChannel(c); setResult(null); }}
              className="rounded-[8px] px-4 py-1.5 text-[12.5px] font-bold transition-colors"
              style={{ background: channel === c ? "#fff" : "transparent", color: channel === c ? accent : "#9E9E9E", boxShadow: channel === c ? "0 1px 3px rgba(0,0,0,0.12)" : "none" }}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Gateway status */}
      {ready ? (
        <div className="mb-4 flex items-center justify-between gap-2 rounded-[10px] bg-[#E8F5E9] px-3 py-2 text-[12px] text-[#2E7D32]">
          <span>✓ {isWa ? "WhatsApp Cloud API configured." : `Gateway configured${senderId ? ` · sender ${senderId}` : ""}.`}</span>
          {!isWa && bal && (
            <span className="shrink-0 rounded-full bg-white/70 px-2.5 py-0.5 text-[11px] font-bold text-[#1B5E20]"
              title={bal.total > 0 ? bal.items.map((i) => `${i.productType}: ${i.credits.toLocaleString("en-IN")}`).join(" · ") : `Raw gateway response: ${bal.raw ?? "—"}`}>
              💳 {bal.currency
                ? `${bal.currency}${bal.total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : `${Math.round(bal.total).toLocaleString("en-IN")} credits`}
            </span>
          )}
        </div>
      ) : (
        <div className="mb-4 rounded-[10px] bg-[#FFF8E1] px-3 py-2 text-[12px] text-[#8D6E00]">
          Not configured — set {miss.join(", ")} in the environment, then restart.
        </div>
      )}

      {isWa && (
        <>
          {/* Send mode: free text (needs the 24h window) vs approved template (reaches any number). */}
          <div className="mb-3 inline-flex rounded-[10px] border border-[#E0E0E0] bg-[#F5F7F5] p-1">
            {([["text", "Free text"], ["template", "Approved template"]] as [WaMode, string][]).map(([m, label]) => (
              <button key={m} type="button" onClick={() => { setWaMode(m); setResult(null); }}
                className="rounded-[8px] px-3.5 py-1.5 text-[12px] font-semibold transition-colors"
                style={{ background: waMode === m ? "#fff" : "transparent", color: waMode === m ? "#0B8A3D" : "#9E9E9E", boxShadow: waMode === m ? "0 1px 3px rgba(0,0,0,0.12)" : "none" }}>
                {label}
              </button>
            ))}
          </div>
          <div className="mb-4 rounded-[10px] px-3 py-2 text-[11.5px]" style={{ background: isTemplateMode ? "#E8F5E9" : "#FFF8E1", color: isTemplateMode ? "#2E7D32" : "#8D6E00" }}>
            {isTemplateMode
              ? "Approved templates reach any number, even a cold one — the reliable way to test (bypasses Meta's 24h window)."
              : "Free-text WhatsApp only reaches numbers that messaged you in the last 24h or your Meta app's registered test numbers. Cold numbers need an approved template."}
          </div>
        </>
      )}

      {/* Recipient: farmer search */}
      <label className="text-[11px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]">Find a farmer <span className="font-normal normal-case text-[#BDBDBD]">(optional)</span></label>
      <div className="relative mt-1">
        <input className={inputCls} placeholder="Search by name or mobile…" value={q}
          onChange={(e) => { setQ(e.target.value); if (picked) setPicked(null); }} />
        {picked && (
          <button type="button" onClick={clearPick} className="absolute right-2 top-1/2 -translate-y-1/2 text-[16px] leading-none text-[#9E9E9E] hover:text-[#C62828]">×</button>
        )}
        {results.length > 0 && !picked && (
          <div className="absolute left-0 right-0 z-20 mt-1 max-h-[220px] overflow-y-auto rounded-[10px] border border-[#E0E0E0] bg-white shadow-[0_6px_20px_rgba(0,0,0,0.12)]">
            {results.map((f) => (
              <button key={f.id} type="button" onClick={() => pick(f)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-[#F5F7F5]">
                <span><span className="font-semibold text-[#1A1C1A]">{f.name}</span> <span className="text-[#9E9E9E]">· {f.village || "—"}</span></span>
                <span className="shrink-0 font-mono text-[11.5px] text-[#616161]">{f.mobile || "no #"}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Recipient: number */}
      <label className="mt-3 block text-[11px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]">Mobile number *</label>
      <input className={`${inputCls} mt-1 tracking-[1px] ${mobile && !mobileValid ? "border-[#EF9A9A]" : ""}`} inputMode="numeric"
        placeholder={isWa ? "Full international number, e.g. 9715XXXXXXXX" : "10-digit number"} value={mobile} maxLength={isWa ? 15 : 10}
        onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, isWa ? 15 : 10))} />
      {mobile && !mobileValid && (
        <div className="mt-1 text-[11px] text-[#C62828]">
          {isWa ? "Enter the full international number incl. country code (8–15 digits, no +)." : "Must be 10 digits starting 6, 7, 8 or 9."}
        </div>
      )}
      {isWa && <div className="mt-1 text-[11px] text-[#9E9E9E]">Testing only — include the country code (a UAE number is 971…). Everywhere else the portal is India-only.</div>}

      {/* Approved-template picker (WhatsApp template mode) */}
      {isTemplateMode ? (
        <div className="mt-3">
          <label className="block text-[11px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]">Approved template *</label>
          {waTemplates.length === 0 ? (
            <div className="mt-1 rounded-[10px] bg-[#FFF8E1] px-3 py-2 text-[12px] text-[#8D6E00]">
              No approved templates yet. Create &amp; submit one in the <b>WhatsApp Templates</b> tab — once Meta approves it, it appears here.
            </div>
          ) : (
            <>
              <select className={`${inputCls} mt-1 bg-white`} value={tplName} onChange={(e) => pickTemplate(e.target.value)}>
                <option value="">Pick an approved template…</option>
                {waTemplates.map((t) => <option key={`${t.name}-${t.language}`} value={t.name}>{t.name} ({t.language}){t.varCount ? ` · ${t.varCount} var` : ""}</option>)}
              </select>
              {selectedTpl && (
                <>
                  {selectedTpl.varCount > 0 && (
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {Array.from({ length: selectedTpl.varCount }).map((_, i) => (
                        <div key={i}>
                          <label className="text-[10px] font-bold uppercase text-[#9E9E9E]">Value for {`{{${i + 1}}}`}</label>
                          <input className={`${inputCls} mt-1`} value={tplParams[i] ?? ""}
                            onChange={(e) => setTplParams((p) => { const n = [...p]; n[i] = e.target.value; return n; })}
                            placeholder={`{{${i + 1}}}`} />
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-2">
                    <div className="text-[10px] font-bold uppercase text-[#9E9E9E]">Preview</div>
                    <div className="mt-1 rounded-[10px] rounded-tl-[3px] bg-[#DCF8C6] px-3 py-2 text-[12.5px] leading-relaxed text-[#1A1C1A] shadow-[0_1px_1px_rgba(0,0,0,0.08)]" dir="auto" style={{ whiteSpace: "pre-wrap" }}>
                      {fillPreview(selectedTpl.body, tplParams)}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          {/* Message + optional plan loader (SMS comm plans only) */}
          <div className="mt-3 flex items-end justify-between gap-2">
            <label className="text-[11px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]">Message *</label>
            {smsPlans.length > 0 && (
              <select value={planId ?? ""} onChange={(e) => loadPlan(e.target.value ? Number(e.target.value) : null)}
                className="max-w-[260px] rounded-[8px] border border-[#E0E0E0] bg-white px-2 py-1 text-[11.5px] text-[#616161] outline-none focus:border-[#2E7D32]">
                <option value="">Load from a Comm Plan…</option>
                {smsPlans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name.trim() || `Untitled plan #${p.id}`} · {DLT_MARK[dltState(p)]}</option>
                ))}
              </select>
            )}
          </div>
          <textarea className={`${inputCls} mt-1 resize-y`} rows={4} value={message} onChange={(e) => setMessage(e.target.value)}
            placeholder="Type your test message…" />
          <div className="mt-1 flex items-center justify-between text-[11px] text-[#9E9E9E]">
            <span>{planId != null ? "Loaded from a Comm Plan — placeholders like [name] are sent as-is in a test." : "Free text."}</span>
            <span>{message.length} chars</span>
          </div>
          {/* DLT status for the loaded plan */}
          {planId != null && (() => {
            const p = smsPlans.find((x) => x.id === planId); if (!p) return null;
            const st = dltState(p); const id = (p.dltTemplateId ?? "").trim();
            const tone = st === "approved" ? { bg: "#E8F5E9", fg: "#2E7D32" } : st === "unknown" ? { bg: "#EEF2F6", fg: "#546E7A" } : { bg: "#FDECEA", fg: "#C62828" };
            const msg = st === "approved" ? `DLT template ${id} — approved ✓`
              : st === "unapproved" ? `DLT id ${id} isn’t in your approved templates — carrier may reject it. Fix it in the Comm Plan.`
              : st === "none" ? "This comm plan has no DLT template id — SMS will be rejected. Add one in the Comm Plan tab."
              : `DLT id ${id} set (approved list not loaded).`;
            return <div className="mt-1.5 rounded-[8px] px-2.5 py-1.5 text-[11.5px] font-medium" style={{ background: tone.bg, color: tone.fg }}>{msg}</div>;
          })()}
        </>
      )}

      {result && (
        <div className={`mt-3 rounded-[10px] px-3 py-2 text-[12px] font-medium ${result.ok ? "bg-[#E8F5E9] text-[#2E7D32]" : "bg-[#FDECEA] text-[#C62828]"}`}>
          {result.ok ? "✓ " : "✕ "}{result.text}
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <button type="button" onClick={send} disabled={!canSend}
          className="rounded-[10px] px-5 py-2.5 text-[13px] font-bold text-white disabled:opacity-50" style={{ background: accent }}>
          {sending ? "Sending…" : isWa ? "⚡ Send test WhatsApp" : "✉ Send test SMS"}
        </button>
      </div>

      {/* WhatsApp delivery status — "Accepted" ≠ delivered. Meta's status webhook fills this in a few
          seconds later (delivered / read, or FAILED with the reason). */}
      {isWa && (
        <div className="mt-5 border-t border-[#F0F0F0] pt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-bold text-[#1A1C1A]">Recent WhatsApp delivery status</span>
            <button type="button" onClick={refreshLogs} className="text-[11.5px] font-semibold text-[#0B8A3D] hover:underline">↻ Refresh</button>
          </div>
          {waLogs == null ? <div className="text-[11.5px] text-[#9E9E9E]">Loading…</div>
            : waLogs.length === 0 ? <div className="text-[11.5px] text-[#BDBDBD]">No WhatsApp sends yet.</div>
            : (
              <div className="flex flex-col gap-1.5">
                {waLogs.map((l) => {
                  const st = (l.status ?? (l.ok ? "SENT" : "FAILED")).toUpperCase();
                  const failed = st.includes("FAIL") || !l.ok;
                  const delivered = st === "DELIVERED" || st === "READ" || !!l.deliveredAt;
                  const color = failed ? "#C62828" : delivered ? "#2E7D32" : "#E65100";
                  const bg = failed ? "#FDECEA" : delivered ? "#E8F5E9" : "#FFF3E0";
                  return (
                    <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-[8px] border border-[#EEE] px-2.5 py-1.5 text-[11.5px]">
                      <span className="font-mono text-[#616161]">{l.mobile}</span>
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: bg, color }}>{st}{st === "READ" ? "" : delivered ? "" : ""}</span>
                      <span className="text-[#9E9E9E]">{new Date(l.createdAt).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true })}</span>
                      {failed && l.error && <span className="text-[#C62828]">{l.error}</span>}
                    </div>
                  );
                })}
              </div>
            )}
          <div className="mt-1.5 text-[11px] text-[#9E9E9E]">Status updates need the webhook subscribed to <b>messages</b> in Meta. FAILED rows show Meta&apos;s error code — that&apos;s the real reason.</div>
        </div>
      )}

      {/* SMS delivery reports — pulled on demand from the gateway (DLR). "Submitted" ≠ delivered. */}
      {!isWa && (
        <div className="mt-5 border-t border-[#F0F0F0] pt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-bold text-[#1A1C1A]">Recent SMS delivery status</span>
            <button type="button" onClick={refreshSmsStatus} disabled={refreshingSms} className="text-[11.5px] font-semibold text-[#6A1B9A] hover:underline disabled:opacity-50">{refreshingSms ? "Checking…" : "↻ Refresh status"}</button>
          </div>
          {smsLogs == null ? <div className="text-[11.5px] text-[#9E9E9E]">Loading…</div>
            : smsLogs.length === 0 ? <div className="text-[11.5px] text-[#BDBDBD]">No SMS sends yet.</div>
            : (
              <div className="flex flex-col gap-1.5">
                {smsLogs.map((l) => {
                  const dlr = (l.deliveryStatus ?? "").toUpperCase();
                  const submitFailed = !l.ok;
                  const failed = submitFailed || dlr === "FAILED";
                  const delivered = dlr === "DELIVERED" || !!l.deliveredAt;
                  const label = submitFailed ? "NOT SENT" : dlr || "SUBMITTED";
                  const color = failed ? "#C62828" : delivered ? "#2E7D32" : "#E65100";
                  const bg = failed ? "#FDECEA" : delivered ? "#E8F5E9" : "#FFF3E0";
                  return (
                    <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-[8px] border border-[#EEE] px-2.5 py-1.5 text-[11.5px]">
                      <span className="font-mono text-[#616161]">{l.mobile}</span>
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: bg, color }}>{label}</span>
                      <span className="text-[#9E9E9E]">{new Date(l.createdAt).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true })}</span>
                      {failed && (l.error || (submitFailed ? l.status : null)) && <span className="text-[#C62828]">{l.error ?? l.status}</span>}
                    </div>
                  );
                })}
              </div>
            )}
          <div className="mt-1.5 text-[11px] text-[#9E9E9E]">SMS delivery reports are pulled on demand — hit <b>Refresh status</b> a few seconds after sending. A blank/PENDING status just means the carrier hasn&apos;t reported back yet.</div>
        </div>
      )}
    </div>
  );
}
