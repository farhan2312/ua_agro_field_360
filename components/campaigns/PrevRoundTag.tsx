"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cropLabel } from "@/lib/crops";
import { prevMediums, prevResponse, prevTagText, prevUnreachable, type PrevRoundContact } from "@/lib/campaign-prev-round";

const fmtIst = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";

/**
 * Small "↩ R1 · Interested" tag on round 2+ lists for farmers who were contacted in an earlier round.
 * Hover (or tap, on phones) shows what was said before — channels, response, note, who and when — so the
 * caller picks up the conversation where it left off. The popover is fixed-positioned in a portal so it
 * isn't clipped by scrolling tables.
 */
export function PrevRoundTag({ prev, size = "sm" }: { prev: PrevRoundContact[] | undefined; size?: "sm" | "xs" }) {
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean } | null>(null);
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const hideT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHide = () => { if (hideT.current) { clearTimeout(hideT.current); hideT.current = null; } };
  // Short grace so the pointer can travel from the tag onto the popover without it vanishing.
  const hideSoon = () => { cancelHide(); hideT.current = setTimeout(() => setPos(null), 180); };
  useEffect(() => cancelHide, []);

  useEffect(() => {
    if (!pos) return;
    const close = () => { setPos(null); setPinned(false); };
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || (t instanceof Element && t.closest("[data-prev-round-pop]"))) return;
      close();
    };
    const onScroll = (e: Event) => { if (e.target instanceof Element && e.target.closest("[data-prev-round-pop]")) return; close(); };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    document.addEventListener("mousedown", onDoc);
    return () => { window.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", close); document.removeEventListener("mousedown", onDoc); };
  }, [pos]);

  if (!prev?.length) return null;
  const last = prev[prev.length - 1];
  const tone = last.response === "INTERESTED" ? { bg: "#E8F5E9", fg: "#1B5E20", bd: "#A5D6A7" }
    : last.response === "NOT_INTERESTED" ? { bg: "#FDECEA", fg: "#B71C1C", bd: "#EF9A9A" }
    : prevUnreachable(last) ? { bg: "#F5F5F5", fg: "#616161", bd: "#D6D6D6" }
    : { bg: "#E3F2FD", fg: "#0D47A1", bd: "#90CAF9" };

  const open = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const W = 300;
    const x = Math.max(8, Math.min(r.left, window.innerWidth - W - 8));
    const up = r.bottom + 220 > window.innerHeight && r.top > 240;
    setPos({ x, y: up ? r.top - 6 : r.bottom + 6, up });
  };

  return (
    <>
      <button ref={ref} type="button"
        onMouseEnter={() => { cancelHide(); if (!pinned) open(); }}
        onMouseLeave={() => { if (!pinned) hideSoon(); }}
        onClick={(e) => { e.stopPropagation(); if (pinned) { setPinned(false); setPos(null); } else { setPinned(true); open(); } }}
        className={`inline-flex shrink-0 items-center gap-1 rounded-full border font-semibold ${size === "xs" ? "px-1.5 py-0 text-[9.5px]" : "px-2.5 py-0.5 text-[10px]"}`}
        style={{ background: tone.bg, color: tone.fg, borderColor: tone.bd }}
        aria-label={`Contacted in an earlier round: ${prevTagText(last)}. Show what was said.`}>
        ↩ {prevTagText(last)}
      </button>
      {pos && typeof document !== "undefined" && createPortal(
        <div role="tooltip" data-prev-round-pop className="fixed z-[1000] w-[300px] rounded-[12px] border border-[#E0E0E0] bg-white p-3 text-left shadow-[0_8px_28px_rgba(0,0,0,0.18)]"
          style={{ left: pos.x, top: pos.y, transform: pos.up ? "translateY(-100%)" : undefined }}
          onMouseEnter={cancelHide} onMouseLeave={() => { if (!pinned) hideSoon(); }}>
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]">Earlier conversation{prev.length > 1 ? "s" : ""}</div>
          <div className="flex max-h-[260px] flex-col gap-2 overflow-y-auto">
            {[...prev].reverse().map((p) => {
              const resp = prevResponse(p);
              return (
                <div key={p.round} className="rounded-[8px] bg-[#F7F8F7] px-2.5 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11.5px] font-bold text-[#1A1C1A]">Round {p.round} · {p.roundName}</span>
                    <span className="shrink-0 text-[10px] text-[#9E9E9E]">{fmtIst(p.at)}</span>
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-[#424242]">
                    {prevUnreachable(p) ? "Couldn't reach them" : [prevMediums(p), resp ? `${resp}${p.response === "OTHER_CROP" && p.responseCrop ? `: ${cropLabel(p.responseCrop)}` : ""}` : ""].filter(Boolean).join(" · ") || "No channel recorded"}
                  </div>
                  {p.comment && <div className="mt-1 whitespace-pre-wrap rounded-[6px] bg-white px-2 py-1 text-[11.5px] italic text-[#333] ring-1 ring-[#EEE]">“{p.comment}”</div>}
                  {p.by && <div className="mt-1 text-[10px] text-[#9E9E9E]">by {p.by}</div>}
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
