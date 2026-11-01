"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateLastWeekNow, regenerateReport } from "@/app/actions/weekly-reports";

const BTN = "rounded-[10px] border border-[#2E7D32] px-3.5 py-2 text-[12.5px] font-semibold text-[#2E7D32] hover:bg-[#E8F5E9] disabled:opacity-50";

/** Admin: build last week's reports now. */
export function GenerateNowButton() {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className={BTN} disabled={busy} onClick={() => start(async () => {
        setMsg(null);
        const r = await generateLastWeekNow();
        setMsg(r.ok
          ? `${r.built ?? 0} built${r.failed ? `, ${r.failed} failed` : ""}${r.remaining ? `, ${r.remaining} still queued (the hourly run finishes them)` : ""}. RMs & Central are notified on the next hourly run.`
          : r.error ?? "Failed.");
        router.refresh();
      })}>
        {busy ? "Generating…" : "⟳ Generate last week now"}
      </button>
      {msg && <span className="text-[11.5px] text-[#616161]">{msg}</span>}
    </span>
  );
}

/** Admin: rebuild one report from current data. */
export function RegenerateButton({ id }: { id: number }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className={BTN} disabled={busy} onClick={() => start(async () => {
        setErr(null);
        const r = await regenerateReport(id);
        if (!r.ok) setErr(r.error ?? "Failed."); else router.refresh();
      })}>
        {busy ? "Regenerating…" : "⟳ Regenerate"}
      </button>
      {err && <span className="text-[11.5px] font-semibold text-[#C62828]">{err}</span>}
    </span>
  );
}
