"use client";

import { useCallback, useEffect, useState } from "react";
import type { TrainingDeck } from "@/lib/training";

/** Windowed slide-deck viewer: a cover with an "Open slideshow" window + a Download button. */
export function DeckViewer({ deck, title }: { deck: TrainingDeck; title: string }) {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const n = deck.slides.length;

  const go = useCallback((d: number) => setI((p) => (p + d + n) % n), [n]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, go]);

  const openAt = (idx: number) => { setI(idx); setOpen(true); };

  return (
    <div>
      {/* Inline cover */}
      <div className="overflow-hidden rounded-[14px] border border-[#E1E9DD] bg-[#F0F5EC]">
        <button type="button" onClick={() => openAt(0)} className="group relative block w-full" aria-label="Open slideshow">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={deck.slides[0]} alt="" className="block w-full" />
          <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/20">
            <span className="flex items-center gap-2 rounded-full bg-white/95 px-5 py-2.5 text-[13px] font-bold text-[#1B5E20] shadow-lg opacity-90 group-hover:opacity-100">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              Open slideshow ({n} slides)
            </span>
          </span>
        </button>
      </div>

      {/* Actions + thumbnails */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => openAt(0)}
          className="rounded-[10px] bg-[#2E7D32] px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-[#1B5E20]">
          ▶ Open slideshow
        </button>
        <a href={deck.file} download
          className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#2E7D32] px-4 py-2 text-[12.5px] font-semibold text-[#2E7D32] hover:bg-[#E8F5E9]">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          {deck.fileLabel}
        </a>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {deck.slides.map((s, idx) => (
          <button key={s} type="button" onClick={() => openAt(idx)}
            className="overflow-hidden rounded-[7px] border border-[#E1E9DD] transition-shadow hover:shadow-md">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s} alt={`Slide ${idx + 1}`} className="block h-[62px] w-auto" />
          </button>
        ))}
      </div>

      {/* Windowed modal */}
      {open && (
        <div className="fixed inset-0 z-[100] flex flex-col bg-black/80 p-3 sm:p-6" onClick={() => setOpen(false)}>
          <div className="mx-auto flex w-full max-w-[1080px] flex-1 flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Window bar */}
            <div className="flex items-center justify-between gap-3 rounded-t-[12px] bg-[#14401B] px-4 py-2.5 text-white">
              <div className="min-w-0 truncate text-[13px] font-semibold">{title}</div>
              <div className="flex items-center gap-2">
                <a href={deck.file} download
                  className="inline-flex items-center gap-1.5 rounded-[8px] bg-white/15 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-white/25">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                  Download
                </a>
                <button type="button" onClick={() => setOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-white/15 text-[18px] leading-none text-white hover:bg-white/25" aria-label="Close">×</button>
              </div>
            </div>
            {/* Stage */}
            <div className="relative flex flex-1 items-center justify-center rounded-b-[12px] bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={deck.slides[i]} alt={`Slide ${i + 1}`} className="max-h-full max-w-full object-contain" />
              <button type="button" onClick={() => go(-1)}
                className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[22px] text-[#14401B] shadow hover:bg-white" aria-label="Previous">‹</button>
              <button type="button" onClick={() => go(1)}
                className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[22px] text-[#14401B] shadow hover:bg-white" aria-label="Next">›</button>
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[12px] font-semibold text-white">
                {i + 1} / {n}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
