"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ConfirmDialog";
import { deleteSalesImport, previewSalesImportDeletion } from "@/app/actions/imports";
import { ErpSyncDashboard } from "./ErpSyncDashboard";
import type { ErpDashboard } from "@/app/actions/erp-sync";

export interface ImportRow {
  id: number;
  filename: string;
  fileType: string;
  uploadedBy: string;
  status: string;
  lineItems: number | null;
  bills: number | null;
  newCustomers: number | null;
  salesInserted: number | null;
  skipped: number | null;
  rangeStart: string | null;
  rangeEnd: string | null;
  error: string | null;
  when: string;
}

const CARD =
  "rounded-[14px] border border-black/[0.04] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]";
const num = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-IN"));

export function SalesImportScreen({ history, dash, erpDefaultDate = "", todayIST = "" }: { history: ImportRow[]; dash: ErpDashboard | null; erpDefaultDate?: string; todayIST?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const { confirm, dialog } = useConfirm();
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [, startDel] = useTransition();

  async function onDelete(h: ImportRow) {
    setDeletingId(h.id);
    try {
      const preview = await previewSalesImportDeletion(h.id);
      const counts = preview.ok
        ? `${(preview.sales ?? 0).toLocaleString("en-IN")} sales record(s)${preview.farmers ? ` and ${(preview.farmers).toLocaleString("en-IN")} new-customer farmer(s)` : ""}`
        : "its sales records";
      const ok = await confirm({
        title: "Delete this import?",
        message: (
          <span>
            Permanently delete <b>{h.filename}</b> and <b>{counts}</b> it added.
            <br />This cannot be undone.
          </span>
        ),
        confirmLabel: "Delete import",
      });
      if (!ok) { setDeletingId(null); return; }
      startDel(async () => {
        const res = await deleteSalesImport(h.id);
        setDeletingId(null);
        if (!res.ok) { setError(res.error ?? "Delete failed."); return; }
        router.refresh();
      });
    } catch {
      setDeletingId(null);
      setError("Delete failed.");
    }
  }

  return (
    <div className="animate-[fadeUp_0.4s_ease-out]">
      {dialog}
      {dash ? <ErpSyncDashboard dash={dash} defaultDate={erpDefaultDate} todayIST={todayIST} /> : (
        <div className={`${CARD} mb-[18px] p-[22px] text-[13px] text-[#9E9E9E]`}>Sync dashboard unavailable — the ERP sync tables may not be reachable right now.</div>
      )}
      {error && <div className={`${CARD} mt-[18px] border-[#F5C6C6] bg-[#FDECEA] px-4 py-3 text-[12.5px] font-medium text-[#C62828]`}>{error}</div>}

      {/* ── Legacy Excel imports (upload retired; kept for reference + cleanup) ── */}
      {history.length > 0 && (
      <div className={`${CARD} mt-[18px] overflow-hidden`}>
        <div className="flex items-center justify-between border-b border-[#F0F0F0] px-[22px] py-3.5">
          <div className="text-[15px] font-bold text-[#1A1C1A]">Legacy Excel imports</div>
          <span className="text-[11px] text-[#9E9E9E]">file upload retired — ERP sync is the source now</span>
        </div>
        {(
          <div className="overflow-x-auto">
            <div className="min-w-[820px] lg:min-w-0">
              <div className="grid grid-cols-[1.6fr_1fr_0.9fr_1.1fr_0.7fr_0.8fr_0.8fr_0.7fr_auto] border-b border-[#F0F0F0] bg-[#FAFAFA] px-[22px] py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.5px] text-[#9E9E9E]">
                <div>File</div><div>When</div><div>By</div><div>Range</div>
                <div className="text-right">Bills</div><div className="text-right">New cust.</div>
                <div className="text-right">Sales added</div><div>Status</div><div />
              </div>
              {history.map((h) => (
                <div key={h.id} className="grid grid-cols-[1.6fr_1fr_0.9fr_1.1fr_0.7fr_0.8fr_0.8fr_0.7fr_auto] items-center border-b border-[#F8F8F8] px-[22px] py-3 text-[12px]">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-[#1A1C1A]" title={h.filename}>{h.filename}</div>
                    {h.error && <div className="truncate text-[10.5px] text-[#C62828]" title={h.error}>{h.error}</div>}
                  </div>
                  <div className="text-[#616161]">{h.when}</div>
                  <div className="truncate text-[#616161]" title={h.uploadedBy}>{h.uploadedBy || "—"}</div>
                  <div className="text-[11.5px] text-[#616161]">
                    {h.rangeStart ? `${h.rangeStart} – ${h.rangeEnd}` : "—"}
                  </div>
                  <div className="text-right font-semibold text-[#1A1C1A]">{num(h.bills)}</div>
                  <div className="text-right text-[#616161]">{num(h.newCustomers)}</div>
                  <div className="text-right font-semibold text-[#2E7D32]">{num(h.salesInserted)}</div>
                  <div>
                    <span
                      className="inline-block rounded-[20px] px-2.5 py-[3px] text-[10px] font-semibold"
                      style={{
                        background: h.status === "SUCCESS" ? "#E8F5E9" : "#FDECEA",
                        color: h.status === "SUCCESS" ? "#2E7D32" : "#C62828",
                      }}
                    >
                      {h.status === "SUCCESS" ? "Success" : "Failed"}
                    </span>
                  </div>
                  <div className="pl-3 text-right">
                    <button
                      type="button"
                      onClick={() => onDelete(h)}
                      disabled={deletingId === h.id}
                      title="Delete this import and the sales it added"
                      className="inline-flex items-center gap-1 rounded-[8px] border border-[#F5C6C6] px-2.5 py-1 text-[11px] font-semibold text-[#C62828] hover:bg-[#FDECEA] disabled:opacity-50"
                    >
                      {deletingId === h.id ? "Deleting…" : (
                        <>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /></svg>
                          Delete
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
