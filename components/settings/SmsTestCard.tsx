"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { searchFarmersForAction } from "@/app/actions/action-registry";
import { sendTestSms } from "@/app/actions/test-messaging";
import type { FarmerPick } from "@/lib/action-constants";

type Plan = { id: number; name: string; template: string; dltTemplateId: string | null };

/**
 * Settings → Test SMS bench. Pick a farmer (search) or type any number, compose a message
 * (free text, optionally loaded from a saved Comm Plan), and fire one SMS through ZapSMS.
 * Admin-only (Settings is sysadmin), every send is logged. WhatsApp test comes later.
 */
export function SmsTestCard({ plans, smsReady, missing, senderId }: {
  plans: Plan[]; smsReady: boolean; missing: string[]; senderId: string;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<FarmerPick[]>([]);
  const [picked, setPicked] = useState<FarmerPick | null>(null);
  const [mobile, setMobile] = useState("");
  const [planId, setPlanId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [sending, startSend] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const lastQ = useRef("");

  // Debounced farmer search.
  useEffect(() => {
    const term = q.trim();
    if (picked && term === picked.name) return; // don't re-search the picked name
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

  const mobileValid = /^[6-9]\d{9}$/.test(mobile);
  const canSend = smsReady && mobileValid && message.trim().length > 0 && !sending;

  const send = () => {
    setResult(null);
    startSend(async () => {
      const r = await sendTestSms({ mobile, message, commTemplateId: planId, farmerId: picked?.id ?? null });
      setResult(r.ok
        ? { ok: true, text: `Sent to ${mobile}${r.providerId ? ` · id ${r.providerId}` : ""}${r.status ? ` · ${r.status}` : ""}` }
        : { ok: false, text: r.error ?? "Send failed." });
    });
  };

  const inputCls = "w-full rounded-[10px] border border-[#E0E0E0] px-3 py-2.5 text-[13px] outline-none focus:border-[#2E7D32]";

  return (
    <div className="rounded-2xl border border-black/[0.03] bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[15px] font-bold text-[#1A1C1A]">Test SMS</span>
        <span className="rounded-full bg-[#F3E5F5] px-2 py-0.5 text-[10.5px] font-bold text-[#6A1B9A]">ZapSMS</span>
      </div>
      <p className="mb-4 text-[12px] text-[#9E9E9E]">Send a one-off SMS to a farmer or any number to verify the gateway. Admin-only; every send is logged.</p>

      {/* Gateway status */}
      {smsReady ? (
        <div className="mb-4 rounded-[10px] bg-[#E8F5E9] px-3 py-2 text-[12px] text-[#2E7D32]">
          ✓ Gateway configured{senderId ? ` · sender ${senderId}` : ""}.
        </div>
      ) : (
        <div className="mb-4 rounded-[10px] bg-[#FFF8E1] px-3 py-2 text-[12px] text-[#8D6E00]">
          Not configured — set {missing.join(", ")} in the environment, then restart.
        </div>
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
        placeholder="10-digit number" value={mobile} maxLength={10}
        onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))} />
      {mobile && !mobileValid && <div className="mt-1 text-[11px] text-[#C62828]">Must be 10 digits starting 6, 7, 8 or 9.</div>}

      {/* Message + optional plan loader */}
      <div className="mt-3 flex items-end justify-between gap-2">
        <label className="text-[11px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]">Message *</label>
        {plans.length > 0 && (
          <select value={planId ?? ""} onChange={(e) => loadPlan(e.target.value ? Number(e.target.value) : null)}
            className="rounded-[8px] border border-[#E0E0E0] bg-white px-2 py-1 text-[11.5px] text-[#616161] outline-none focus:border-[#2E7D32]">
            <option value="">Load from a Comm Plan…</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>
      <textarea className={`${inputCls} mt-1 resize-y`} rows={4} value={message} onChange={(e) => setMessage(e.target.value)}
        placeholder="Type your test message…" />
      <div className="mt-1 flex items-center justify-between text-[11px] text-[#9E9E9E]">
        <span>{planId != null ? "Loaded from a Comm Plan — placeholders like [Naam] are sent as-is in a test." : "Free text."}</span>
        <span>{message.length} chars</span>
      </div>

      {result && (
        <div className={`mt-3 rounded-[10px] px-3 py-2 text-[12px] font-medium ${result.ok ? "bg-[#E8F5E9] text-[#2E7D32]" : "bg-[#FDECEA] text-[#C62828]"}`}>
          {result.ok ? "✓ " : "✕ "}{result.text}
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <button type="button" onClick={send} disabled={!canSend}
          className="rounded-[10px] bg-[#6A1B9A] px-5 py-2.5 text-[13px] font-bold text-white hover:bg-[#4A148C] disabled:opacity-50">
          {sending ? "Sending…" : "✉ Send test SMS"}
        </button>
      </div>
    </div>
  );
}
