"use client";

import { useState, useTransition } from "react";
import { reviewVisit, unreviewVisit } from "@/app/actions/visit-review";

/** Optional visit sign-off. Shows the review state; eligible reviewers can add / edit / clear it. */
export function VisitReviewSection({
  visitId, reviewed, reviewNote, reviewedBy, canReview,
}: { visitId: number; reviewed: boolean; reviewNote: string; reviewedBy: string; canReview: boolean }) {
  const [editing, setEditing] = useState(!reviewed && canReview);
  const [note, setNote] = useState(reviewNote);
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const save = () => start(async () => {
    setErr(null);
    const r = await reviewVisit(visitId, note);
    if (r.ok) location.reload(); else setErr(r.error ?? "Failed.");
  });
  const remove = () => start(async () => {
    setErr(null);
    const r = await unreviewVisit(visitId);
    if (r.ok) location.reload(); else setErr(r.error ?? "Failed.");
  });

  const box = "rounded-2xl border p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]";

  // Viewer can't review an un-reviewed visit (e.g. the recording officer) — make it clear the
  // sign-off is the Regional Manager's task, not pending work on the officer's side.
  if (!reviewed && !canReview) {
    return (
      <div className={`${box} border-[#E3EAF0] bg-[#F7F9FB]`}>
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-bold text-[#1A1C1A]">Visit review</span>
          <span className="rounded-full bg-[#ECEFF1] px-2 py-0.5 text-[10.5px] font-bold text-[#546E7A]">Awaiting RM sign-off</span>
        </div>
        <p className="mt-1.5 text-[12.5px] text-[#607D8B]">Reviewing this visit is the Regional Manager’s task — nothing is pending on your side.</p>
      </div>
    );
  }

  return (
    <div className={`${box} ${reviewed ? "border-[#C8E6C9] bg-[#F6FBF6]" : "border-[#FFE0B2] bg-[#FFFDF7]"}`}>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[14px] font-bold text-[#1A1C1A]">Visit review</span>
        <span className="rounded-full px-2 py-0.5 text-[10.5px] font-bold"
          style={{ background: reviewed ? "#E8F5E9" : "#FFF3E0", color: reviewed ? "#2E7D32" : "#E65100" }}>
          {reviewed ? "✓ Reviewed" : "Not yet reviewed"}
        </span>
      </div>

      {reviewed && !editing && (
        <>
          {reviewNote
            ? <div className="rounded-[10px] bg-white/70 px-3.5 py-2.5 text-[13px] leading-relaxed text-[#33691E] ring-1 ring-[#E8F5E9]">{reviewNote}</div>
            : <div className="text-[12.5px] italic text-[#9E9E9E]">Signed off with no note.</div>}
          <div className="mt-2 text-[11.5px] text-[#616161]">Signed off by {reviewedBy}</div>
          {canReview && (
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => { setNote(reviewNote); setEditing(true); }} className="rounded-[10px] border border-[#2E7D32] px-3.5 py-1.5 text-[12px] font-semibold text-[#2E7D32] hover:bg-[#E8F5E9]">Edit note</button>
              <button type="button" onClick={remove} disabled={busy} className="rounded-[10px] border border-[#E0E0E0] px-3.5 py-1.5 text-[12px] font-semibold text-[#C62828] hover:bg-[#FDECEA] disabled:opacity-50">Remove review</button>
            </div>
          )}
        </>
      )}

      {canReview && (editing || !reviewed) && (
        <>
          {!reviewed && <p className="mb-2 text-[12px] text-[#8D6E00]">Optional sign-off — add a short note and mark this visit reviewed.</p>}
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
            placeholder="Sign-off note (optional)…"
            className="w-full resize-y rounded-[10px] border border-[#E0E0E0] px-3.5 py-2.5 text-[13px] outline-none focus:border-[#2E7D32]" />
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={save} disabled={busy} className="rounded-[10px] bg-[#2E7D32] px-4 py-2 text-[13px] font-bold text-white hover:bg-[#1B5E20] disabled:opacity-50">{busy ? "Saving…" : reviewed ? "Save note" : "Mark reviewed"}</button>
            {reviewed && <button type="button" onClick={() => setEditing(false)} className="rounded-[10px] border border-[#E0E0E0] px-4 py-2 text-[13px] font-semibold text-[#616161]">Cancel</button>}
          </div>
        </>
      )}

      {err && <div className="mt-2 text-[12px] font-semibold text-[#C62828]">{err}</div>}
    </div>
  );
}
