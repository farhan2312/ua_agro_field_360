"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { initials } from "@/lib/format";
import { listConversations, getThread, type InboxData, type ConversationVM, type ThreadVM } from "@/app/actions/whatsapp-inbox";

type Filter = "all" | "unread" | "unmatched";
const DAY = 86_400_000;

const relTime = (iso: string | null): string => {
  if (!iso) return "";
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60_000) return "now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < DAY) return `${Math.floor(d / 3_600_000)}h`;
  if (d < 7 * DAY) return `${Math.floor(d / DAY)}d`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};
const fmtTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

export function WhatsAppInbox({ initial }: { initial: InboxData | null }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [data, setData] = useState<InboxData | null>(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadVM | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = (f: Filter, term: string) => listConversations(f, term).then(setData);
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => load(filter, q), 250);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [filter, q]); // eslint-disable-line

  const open = (mobile: string) => {
    setSelected(mobile); setThread(null); setLoadingThread(true);
    getThread(mobile).then((t) => {
      setThread(t); setLoadingThread(false);
      // Clear the unread badge locally.
      setData((d) => d ? { ...d, conversations: d.conversations.map((c) => c.mobile === mobile ? { ...c, unreadCount: 0 } : c), totalUnread: Math.max(0, d.totalUnread - (d.conversations.find((c) => c.mobile === mobile)?.unreadCount ?? 0)) } : d);
    });
  };

  const convos = data?.conversations ?? [];

  return (
    <div className="animate-fadeUp">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-[18px] font-bold text-[#1A1C1A]">💬 WhatsApp Inbox</h1>
        {(data?.totalUnread ?? 0) > 0 && <span className="rounded-full bg-[#E53935] px-2 py-0.5 text-[11px] font-bold text-white">{data!.totalUnread} unread</span>}
        <span className="text-[12px] text-[#9E9E9E]">{data?.total ?? 0} contacts have messaged the official number</span>
        <button type="button" onClick={() => load(filter, q)} className="ml-auto rounded-[8px] border border-[#E0E0E0] px-3 py-1.5 text-[12px] font-semibold text-[#616161] hover:bg-[#F5F5F5]">↻ Refresh</button>
      </div>

      <div className="flex h-[calc(100vh-190px)] min-h-[460px] overflow-hidden rounded-[14px] border border-black/[0.04] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        {/* Conversation list */}
        <div className={`flex w-full flex-col border-r border-[#F0F0F0] sm:w-[340px] ${selected ? "hidden sm:flex" : "flex"}`}>
          <div className="border-b border-[#F0F0F0] p-2.5">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, number, message…"
              className="mb-2 w-full rounded-[8px] border border-[#E0E0E0] px-3 py-1.5 text-[12.5px] outline-none focus:border-[#2E7D32]" />
            <div className="flex gap-1">
              {([["all", "All"], ["unread", "Unread"], ["unmatched", "Not a farmer"]] as [Filter, string][]).map(([f, l]) => (
                <button key={f} type="button" onClick={() => setFilter(f)}
                  className="rounded-full px-3 py-1 text-[11.5px] font-semibold"
                  style={{ background: filter === f ? "#E8F5E9" : "#F5F5F5", color: filter === f ? "#2E7D32" : "#9E9E9E" }}>{l}</button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {convos.length === 0 ? (
              <div className="px-4 py-12 text-center text-[12.5px] text-[#9E9E9E]">No conversations{q ? " match" : " yet"}.</div>
            ) : convos.map((c) => <ConvRow key={c.mobile} c={c} active={c.mobile === selected} onClick={() => open(c.mobile)} />)}
          </div>
        </div>

        {/* Thread */}
        <div className={`min-w-0 flex-1 flex-col bg-[#F7F6F3] ${selected ? "flex" : "hidden sm:flex"}`}>
          {!selected ? (
            <div className="grid h-full place-items-center text-center text-[13px] text-[#9E9E9E]">
              <div><div className="text-[34px]">💬</div><div className="mt-1">Pick a conversation to read the full record</div></div>
            </div>
          ) : loadingThread || !thread ? (
            <div className="grid h-full place-items-center text-[13px] text-[#9E9E9E]">Loading…</div>
          ) : (
            <ThreadView thread={thread} onBack={() => { setSelected(null); setThread(null); }} />
          )}
        </div>
      </div>

      <div className="mt-2 text-[11px] text-[#9E9E9E]">Two-way replies &amp; quick responses arrive in Phase 2. This page records every inbound message; reply from WhatsApp directly for now.</div>
    </div>
  );
}

function ConvRow({ c, active, onClick }: { c: ConversationVM; active: boolean; onClick: () => void }) {
  const title = c.name || c.mobile;
  return (
    <button type="button" onClick={onClick}
      className="flex w-full items-center gap-2.5 border-b border-[#F7F7F7] px-3 py-2.5 text-left hover:bg-[#FAFBFA]"
      style={{ background: active ? "#F1F8F1" : undefined }}>
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#25D366]/15 text-[12px] font-bold text-[#0B8A3D]">{initials(title)}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-semibold text-[#1A1C1A]">{title}</span>
          {c.within24h && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#25D366]" title="Reply window open (messaged in last 24h)" />}
          <span className="ml-auto shrink-0 text-[10.5px] text-[#9E9E9E]">{relTime(c.lastMessageAt)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-[#757575]">{c.lastDirection === "OUT" ? "You: " : ""}{c.lastMessage || "—"}</span>
          {c.unreadCount > 0 && <span className="shrink-0 rounded-full bg-[#25D366] px-1.5 py-0.5 text-[9px] font-bold text-white">{c.unreadCount}</span>}
        </div>
        <div className="mt-0.5 text-[10px] text-[#BDBDBD]">{c.mobile}{c.farmerId ? " · farmer" : " · not a farmer"}</div>
      </div>
    </button>
  );
}

function ThreadView({ thread, onBack }: { thread: ThreadVM; onBack: () => void }) {
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { bottom.current?.scrollIntoView(); }, [thread.mobile]);
  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-[#E7E7E7] bg-white px-3.5 py-2.5">
        <button type="button" onClick={onBack} className="sm:hidden text-[16px] text-[#616161]">←</button>
        <div className="grid h-9 w-9 place-items-center rounded-full bg-[#25D366]/15 text-[12px] font-bold text-[#0B8A3D]">{initials(thread.name || thread.mobile)}</div>
        <div className="min-w-0">
          <div className="text-[13.5px] font-bold text-[#1A1C1A]">{thread.name || thread.mobile}</div>
          <div className="text-[11px] text-[#9E9E9E]">
            {thread.mobile}
            {thread.farmerId ? <> · <Link href={`/farmers/${thread.farmerId}`} className="font-semibold text-[#1565C0] hover:underline">{thread.farmerName || "View farmer"}</Link></> : " · not a farmer"}
          </div>
        </div>
        <span className="ml-auto rounded-full px-2 py-0.5 text-[10.5px] font-bold"
          style={{ background: thread.within24h ? "#E8F5E9" : "#FFF3E0", color: thread.within24h ? "#2E7D32" : "#E65100" }}>
          {thread.within24h ? "● Session open" : "Session closed · template only"}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-3.5 py-4">
        {thread.messages.length === 0 ? (
          <div className="py-8 text-center text-[12px] text-[#9E9E9E]">
            No per-message record before this contact&apos;s messages started being logged.
            {thread.firstMessage && <div className="mt-1 text-[#BDBDBD]">First message on record: “{thread.firstMessage}”</div>}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {thread.messages.map((m) => {
              const out = m.direction === "OUT";
              const isMedia = m.type !== "text" && !!m.mediaId;
              return (
                <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                  <div className="max-w-[78%] rounded-[10px] px-3 py-2 text-[13px] leading-relaxed shadow-[0_1px_1px_rgba(0,0,0,0.08)]"
                    style={{ background: out ? "#DCF8C6" : "#fff", borderTopLeftRadius: out ? undefined : 3, borderTopRightRadius: out ? 3 : undefined }}>
                    {isMedia
                      ? <span className="italic text-[#616161]">📎 {m.type} {m.mediaMime ? `(${m.mediaMime})` : ""}</span>
                      : <span className="whitespace-pre-wrap text-[#1A1C1A]" dir="auto">{m.text}</span>}
                    <div className="mt-1 flex items-center justify-end gap-1 text-[9.5px] text-[#9E9E9E]">
                      {fmtTime(m.at)}
                      {out && m.status && <span className={m.status === "FAILED" ? "text-[#C62828]" : "text-[#4FC3F7]"}>· {m.status.toLowerCase()}</span>}
                    </div>
                    {out && m.status === "FAILED" && m.errorText && <div className="text-[9.5px] text-[#C62828]">{m.errorText}</div>}
                  </div>
                </div>
              );
            })}
            <div ref={bottom} />
          </div>
        )}
      </div>
    </>
  );
}
