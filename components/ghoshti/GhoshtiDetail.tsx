"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Modal, ModalHeader } from "@/components/interactive";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  addGhoshtiAttendees, removeGhoshtiAttendee, approveGhoshti, rejectGhoshti,
  getGhoshti, type GhoshtiDetailVM,
} from "@/app/actions/ghoshti";
import type { RoleKey } from "@/lib/roles";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  PENDING: { bg: "#FFF3E0", fg: "#E65100", label: "Pending approval" },
  APPROVED: { bg: "#E8F5E9", fg: "#2E7D32", label: "Approved" },
  REJECTED: { bg: "#FDECEA", fg: "#C62828", label: "Rejected" },
};

export function GhoshtiDetail({ initial, role }: { initial: GhoshtiDetailVM; role: RoleKey }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [g, setG] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [, start] = useTransition();

  const st = STATUS_STYLE[g.status] ?? STATUS_STYLE.PENDING;
  const existingCount = useMemo(() => g.attendees.filter((a) => a.isExisting).length, [g.attendees]);

  const reload = async () => { const fresh = await getGhoshti(g.id); if (fresh) setG(fresh); };

  const approve = async () => {
    if (!(await confirm({ title: "Approve this Ghoshti?", message: `${g.attendees.length} attendee(s); ${existingCount} matched existing farmer(s) will be flagged as having attended a Ghoshti.`, confirmLabel: "Approve" }))) return;
    start(async () => { const r = await approveGhoshti(g.id); if (!r.ok) { alert(r.error ?? "Failed."); return; } reload(); });
  };
  const doReject = () => {
    start(async () => {
      const r = await rejectGhoshti({ ghoshtiId: g.id, note: rejectNote || undefined });
      if (!r.ok) { alert(r.error ?? "Failed."); return; }
      setRejecting(false); setRejectNote(""); reload();
    });
  };
  const removeAttendee = async (id: number, label: string) => {
    if (!(await confirm({ title: "Remove attendee?", message: label, confirmLabel: "Remove" }))) return;
    const prev = g.attendees;
    setG((x) => ({ ...x, attendees: x.attendees.filter((a) => a.id !== id) }));
    start(async () => { const r = await removeGhoshtiAttendee({ ghoshtiId: g.id, attendeeId: id }); if (!r.ok) { setG((x) => ({ ...x, attendees: prev })); alert(r.error ?? "Failed."); } });
  };

  return (
    <div className="animate-[fadeUp_0.4s_ease-out]">
      {dialog}

      <div className="mb-4 flex items-center justify-between gap-2">
        <Link href="/ghoshti" className="text-[12.5px] font-semibold text-[#2E7D32] hover:underline">← All meetups</Link>
        <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
      </div>

      {/* Summary card */}
      <div className="rounded-[14px] border border-black/[0.03] bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[19px] font-bold text-[#1A1C1A]">{g.topic || "Farmer Ghoshti"}</div>
            <div className="mt-1 text-[13px] text-[#616161]">
              {fmtDate(g.date)} · {g.storeName}{g.zone ? ` · ${g.zone}` : ""}
            </div>
            {g.locationNote && <div className="mt-0.5 text-[12.5px] text-[#9E9E9E]">📍 {g.locationNote}</div>}
          </div>
          <div className="text-right text-[11.5px] text-[#9E9E9E]">
            <div>Organised by <b className="text-[#616161]">{g.createdBy}</b>{g.createdByCode ? ` (${g.createdByCode})` : ""}</div>
            <div>{fmtDateTime(g.createdAt)}</div>
          </div>
        </div>

        {g.notes && <div className="mt-3 rounded-[10px] bg-[#FAFAFA] px-3.5 py-2.5 text-[12.5px] text-[#424242]">{g.notes}</div>}

        {g.status === "APPROVED" && g.approvedBy && (
          <div className="mt-3 rounded-[10px] bg-[#F1F8F1] px-3.5 py-2 text-[12px] text-[#2E7D32]">
            ✓ Approved by <b>{g.approvedBy}</b>{g.approvedAt ? ` · ${fmtDateTime(g.approvedAt)}` : ""}
          </div>
        )}
        {g.status === "REJECTED" && (
          <div className="mt-3 rounded-[10px] bg-[#FDECEA] px-3.5 py-2 text-[12px] text-[#C62828]">
            ✗ Rejected by <b>{g.approvedBy ?? "—"}</b>{g.approvedAt ? ` · ${fmtDateTime(g.approvedAt)}` : ""}{g.rejectionNote ? ` — ${g.rejectionNote}` : ""}
          </div>
        )}

        {/* Approval actions */}
        {g.canApprove && (
          <div className="mt-4 flex items-center gap-2 border-t border-[#F0F0F0] pt-4">
            <button type="button" onClick={approve}
              className="rounded-[10px] bg-[#2E7D32] px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-[#1B5E20]">✓ Approve meetup</button>
            <button type="button" onClick={() => setRejecting(true)}
              className="rounded-[10px] border border-[#E0E0E0] px-4 py-2 text-[12.5px] font-semibold text-[#C62828] hover:bg-[#FDECEA]">Reject</button>
          </div>
        )}
      </div>

      {/* Attendees */}
      <div className="mt-4 rounded-[14px] border border-black/[0.03] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F0F0F0] px-5 py-3.5">
          <div>
            <span className="text-[14px] font-bold text-[#1A1C1A]">Attendees</span>
            <span className="ml-2 text-[12px] text-[#9E9E9E]">{g.attendees.length} total · {existingCount} existing farmer(s) · {g.attendees.length - existingCount} new</span>
          </div>
          {g.canEdit && (
            <button type="button" onClick={() => setAdding(true)}
              className="rounded-[10px] bg-[#2E7D32] px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-[#1B5E20]">+ Add attendees</button>
          )}
        </div>

        {g.attendees.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="text-[26px]">👥</div>
            <div className="mt-2 text-[13.5px] font-bold text-[#1A1C1A]">No attendees recorded</div>
            <div className="mt-1 text-[12px] text-[#9E9E9E]">Add attendees by their mobile number.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[12.5px]">
              <thead>
                <tr className="border-b border-[#EEE] text-left text-[10.5px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]">
                  <th className="px-5 py-3">Mobile</th><th className="px-4 py-3">Name</th><th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Remarks</th>{g.canEdit && <th className="px-4 py-3 text-right">Action</th>}
                </tr>
              </thead>
              <tbody>
                {g.attendees.map((a) => (
                  <tr key={a.id} className="border-b border-[#F5F5F5] last:border-0 hover:bg-[#FAFBFA]">
                    <td className="whitespace-nowrap px-5 py-3 font-medium text-[#333]">{a.mobile}</td>
                    <td className="px-4 py-3">
                      {a.isExisting && a.matchedFarmerId
                        ? <Link href={`/farmers/${a.matchedFarmerId}`} className="font-semibold text-[#1565C0] hover:underline">{a.name || "View farmer"}</Link>
                        : <span className="text-[#616161]">{a.name || "—"}</span>}
                    </td>
                    <td className="px-4 py-3">
                      {a.isExisting
                        ? <span className="rounded-full bg-[#E8F5E9] px-2 py-0.5 text-[10.5px] font-bold text-[#2E7D32]">Existing</span>
                        : <span className="rounded-full bg-[#FFF3E0] px-2 py-0.5 text-[10.5px] font-bold text-[#E65100]">New</span>}
                    </td>
                    <td className="px-4 py-3 text-[#9E9E9E]">{a.remarks || "—"}</td>
                    {g.canEdit && (
                      <td className="px-4 py-3 text-right">
                        <button type="button" onClick={() => removeAttendee(a.id, `${a.mobile}${a.name ? ` · ${a.name}` : ""}`)}
                          className="rounded-md bg-[#FDECEA] px-2 py-1 text-[11px] font-semibold text-[#C62828] hover:bg-[#FADBD8]">Remove</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {adding && (
        <AddAttendeesModal
          ghoshtiId={g.id}
          onClose={() => setAdding(false)}
          onAdded={() => { setAdding(false); reload(); router.refresh(); }}
        />
      )}

      {/* Reject reason */}
      <Modal open={rejecting} onClose={() => setRejecting(false)} className="max-w-[460px]">
        <ModalHeader eyebrow="Reject Ghoshti" eyebrowColor="#C62828" title="Reason for rejection" onClose={() => setRejecting(false)} />
        <div className="px-5 py-4">
          <textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} rows={3} autoFocus
            placeholder="Optional — tell the organiser why this was rejected."
            className="w-full resize-y rounded-[10px] border border-[#E0E0E0] px-3.5 py-2.5 text-[13px] outline-none focus:border-[#C62828]" />
          <div className="mt-4 flex items-center justify-end gap-2">
            <button type="button" onClick={() => setRejecting(false)} className="rounded-[10px] border border-[#E0E0E0] px-4 py-2 text-[12.5px] font-semibold text-[#616161] hover:bg-[#F5F5F5]">Cancel</button>
            <button type="button" onClick={doReject} className="rounded-[10px] bg-[#C62828] px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-[#B71C1C]">Reject meetup</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function AddAttendeesModal({
  ghoshtiId, onClose, onAdded,
}: {
  ghoshtiId: number; onClose: () => void; onAdded: () => void;
}) {
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  // Parse "mobile, name, remarks" per line (name/remarks optional).
  const parse = () =>
    text.split(/\r?\n/).map((line) => {
      const parts = line.split(/[,\t]/).map((p) => p.trim());
      const mobile = parts[0] ?? "";
      return { mobile, name: parts[1] || undefined, remarks: parts[2] || undefined };
    }).filter((r) => r.mobile);

  const submit = () => {
    setErr(null); setMsg(null);
    const rows = parse();
    if (rows.length === 0) { setErr("Enter at least one mobile number."); return; }
    startSave(async () => {
      const r = await addGhoshtiAttendees({ ghoshtiId, rows });
      if (!r.ok) { setErr(r.error ?? "Failed to add."); return; }
      setMsg(`Added ${r.added} attendee(s) — ${r.existing} matched existing farmers${r.skipped ? `, ${r.skipped} skipped (duplicate/invalid)` : ""}.`);
      if ((r.added ?? 0) > 0) setTimeout(onAdded, 900);
    });
  };

  return (
    <Modal open onClose={onClose} className="max-w-[520px]">
      <ModalHeader eyebrow="Attendees" eyebrowColor="#2E7D32" title="Add attendees" onClose={onClose} />
      <div className="max-h-[76vh] overflow-y-auto px-5 py-4">
        <label className="text-[11px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]">One per line — mobile, name, remarks</label>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} autoFocus
          placeholder={"9876543210, Ramesh Kumar\n9812345678, Suresh, brought neighbour\n9900112233"}
          className="mt-1 w-full resize-y rounded-[10px] border border-[#E0E0E0] px-3.5 py-2.5 font-mono text-[12.5px] outline-none focus:border-[#2E7D32]" />
        <div className="mt-1.5 text-[11.5px] text-[#9E9E9E]">
          Name &amp; remarks are optional. Each mobile is matched against existing farmers automatically — only the 10-digit number is required (must start 6–9).
        </div>

        {err && <div className="mt-3 rounded-[8px] bg-[#FDECEA] px-3 py-2 text-[12px] font-semibold text-[#C62828]">{err}</div>}
        {msg && <div className="mt-3 rounded-[8px] bg-[#E8F5E9] px-3 py-2 text-[12px] font-semibold text-[#2E7D32]">{msg}</div>}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-[10px] border border-[#E0E0E0] px-4 py-2 text-[12.5px] font-semibold text-[#616161] hover:bg-[#F5F5F5]">Close</button>
          <button type="button" onClick={submit} disabled={saving}
            className="rounded-[10px] bg-[#2E7D32] px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-[#1B5E20] disabled:opacity-50">
            {saving ? "Adding…" : "Add attendees"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
