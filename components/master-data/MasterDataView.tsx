"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/ui";
import { Modal, ModalHeader } from "@/components/interactive";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { StoreEditModal, FarmerEditModal } from "./EditModal";
import type {
  StoreRow,
  FarmerRow,
  EmployeeRow,
  MasterDataTab,
} from "./types";

/** ~9% / ~8% alpha suffix kept as inline style (runtime hex). */
function alpha(hex: string, suffix: string) {
  return `${hex}${suffix}`;
}

/* ── Sub-tab pill bar ── */

function TabBar({
  active,
  onChange,
}: {
  active: MasterDataTab;
  onChange: (t: MasterDataTab) => void;
}) {
  const tabs: { key: MasterDataTab; label: string }[] = [
    { key: "stores", label: "Stores" },
    { key: "farmers", label: "Farmers" },
    { key: "employees", label: "Employees" },
  ];
  return (
    <div className="mb-[22px] flex w-fit gap-1.5 rounded-xl bg-white p-[5px] shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      {tabs.map((t) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={cn(
              "cursor-pointer rounded-lg px-[22px] py-2 text-[13px] font-semibold transition-all duration-150",
              isActive ? "bg-brand-900 text-white" : "bg-transparent text-[#757575]",
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Generic table card shell ── */

function TableCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-[#F0F0F0] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      {children}
    </div>
  );
}

function HeaderRow({
  cols,
  gap,
  labels,
}: {
  cols: string;
  gap: string;
  labels: string[];
}) {
  return (
    <div
      className={cn(
        "grid border-b border-[#EEEEEE] bg-[#F8F8F8] px-5 py-3 text-[11px] font-bold tracking-[0.04em] text-[#9E9E9E]",
        gap,
      )}
      style={{ gridTemplateColumns: cols }}
    >
      {labels.map((l) => (
        <div key={l}>{l}</div>
      ))}
    </div>
  );
}

/* ── STORES table ── */

const STORE_COLS = "0.5fr 1.4fr 1fr 1fr 1fr 0.8fr 0.6fr";

function StoresTable({
  rows,
  onOpen,
}: {
  rows: StoreRow[];
  onOpen: (s: StoreRow) => void;
}) {
  return (
    <TableCard>
      <HeaderRow
        cols={STORE_COLS}
        gap="gap-3"
        labels={[
          "CODE",
          "STORE NAME",
          "ZONE / DISTRICT",
          "AGRI OFFICER",
          "BDM",
          "FARMERS",
          "STATUS",
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState title="No stores" hint="Master store records will appear here." />
      ) : (
        rows.map((st) => (
          <div
            key={st.id}
            onClick={() => onOpen(st)}
            className="grid cursor-pointer items-start gap-3 border-b border-[#F5F5F5] px-5 py-3.5 transition-[background] duration-[120ms] hover:bg-[#FAFFF8]"
            style={{ gridTemplateColumns: STORE_COLS }}
          >
            <div>
              <div
                className="w-fit rounded-md px-[7px] py-[3px] text-[10.5px] font-bold"
                style={{ color: st.color, background: alpha(st.color, "18") }}
              >
                {st.code}
              </div>
            </div>
            <div>
              <div className="mb-0.5 text-[13px] font-bold text-[#1A1C1A]">
                {st.name}
              </div>
              <div className="text-[11px] leading-[1.4] text-[#9E9E9E]">
                {st.address}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-ink">{st.zone}</div>
              <div className="text-[11px] text-[#9E9E9E]">{st.district}</div>
            </div>
            <div>
              <div className="mb-0.5 text-xs font-semibold text-ink">
                {st.ao1Name}
              </div>
              <div className="text-[10.5px] text-[#9E9E9E]">{st.ao1Mobile}</div>
              {st.ao2Name && (
                <>
                  <div className="mt-1.5 text-[11.5px] font-semibold text-ink">
                    {st.ao2Name}
                  </div>
                  <div className="text-[10.5px] text-[#9E9E9E]">
                    {st.ao2Mobile}
                  </div>
                </>
              )}
            </div>
            <div>
              <div className="text-xs font-semibold text-ink">{st.bdmName}</div>
              <div className="text-[10.5px] text-[#9E9E9E]">{st.bdmMobile}</div>
            </div>
            <div>
              <div className="text-sm font-extrabold text-[#2E7D32]">
                {st.farmerCountLabel}
              </div>
              <div className="text-[10.5px] text-[#9E9E9E]">registered</div>
            </div>
            <div>
              <div className="w-fit rounded-full bg-[#E8F5E9] px-2.5 py-[3px] text-[10.5px] font-semibold text-[#2E7D32]">
                {st.status}
              </div>
            </div>
          </div>
        ))
      )}
    </TableCard>
  );
}

/* ── FARMERS table ── */

const FARMER_COLS =
  "0.3fr 0.5fr 1.2fr 0.9fr 1fr 0.8fr 0.7fr 0.8fr 0.8fr";

function FarmersTable({
  rows,
  onOpen,
}: {
  rows: FarmerRow[];
  onOpen: (f: FarmerRow) => void;
}) {
  return (
    <TableCard>
      <HeaderRow
        cols={FARMER_COLS}
        gap="gap-2.5"
        labels={[
          "#",
          "CODE",
          "FARMER NAME",
          "MOBILE",
          "VILLAGE",
          "CROP",
          "STORE",
          "AGR. OFFICER",
          "SEGMENT",
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState title="No farmers" hint="Farmer records will appear here." />
      ) : (
        rows.map((fr) => (
          <div
            key={fr.id}
            onClick={() => onOpen(fr)}
            className="grid cursor-pointer items-center gap-2.5 border-b border-[#F5F5F5] px-5 py-3 transition-[background] duration-[120ms] hover:bg-[#FAFFF8]"
            style={{ gridTemplateColumns: FARMER_COLS }}
          >
            <div className="text-[11px] font-semibold text-[#BDBDBD]">
              {fr.idx}
            </div>
            <div className="w-fit rounded-[5px] bg-[#F5F5F5] px-1.5 py-0.5 text-[10.5px] font-bold text-[#757575]">
              {fr.code}
            </div>
            <div>
              <div className="text-[13px] font-semibold text-[#1A1C1A]">
                {fr.name}
              </div>
              <div className="text-[10.5px] text-[#9E9E9E]">{fr.district}</div>
            </div>
            <div className="text-xs font-medium text-[#1565C0]">{fr.mobile}</div>
            <div className="text-xs text-[#424242]">{fr.village}</div>
            <div className="text-xs text-[#424242]">{fr.crop}</div>
            <div
              className="text-[11px] font-bold"
              style={{ color: fr.storeColor }}
            >
              {fr.storeName}
            </div>
            <div className="text-[11.5px] text-[#424242]">{fr.aoName}</div>
            <div>
              {fr.segment ? (
                <span className="inline-block w-fit rounded-full bg-[#E8F5E9] px-[9px] py-[3px] text-[10.5px] font-semibold text-[#2E7D32]">
                  {fr.segment}
                </span>
              ) : (
                <span className="text-[10.5px] text-[#BDBDBD]">—</span>
              )}
            </div>
          </div>
        ))
      )}
    </TableCard>
  );
}

/* ── EMPLOYEES table ── */

const EMP_COLS = "0.3fr 1.4fr 1fr 1fr 0.8fr 1.2fr";

function EmployeesTable({ rows, onOpen }: { rows: EmployeeRow[]; onOpen: (e: EmployeeRow) => void }) {
  return (
    <TableCard>
      <HeaderRow
        cols={EMP_COLS}
        gap="gap-3"
        labels={[
          "#",
          "EMPLOYEE NAME",
          "ROLE",
          "MOBILE",
          "STORE CODE",
          "STORE NAME",
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState
          title="No employees"
          hint="Store staff records will appear here."
        />
      ) : (
        rows.map((emp) => (
          <div
            key={emp.id}
            onClick={() => onOpen(emp)}
            className="grid cursor-pointer items-center gap-3 border-b border-[#F5F5F5] px-5 py-[13px] transition-[background] duration-[120ms] hover:bg-[#FAFFF8]"
            style={{ gridTemplateColumns: EMP_COLS }}
          >
            <div className="text-[11px] font-semibold text-[#BDBDBD]">
              {emp.idx}
            </div>
            <div>
              <div className="text-[13px] font-semibold text-[#1A1C1A]">
                {emp.name}
              </div>
              <div className="text-[10.5px] text-[#9E9E9E]">{emp.email}</div>
            </div>
            <div>
              <div
                className="w-fit rounded-full px-2.5 py-[3px] text-[10.5px] font-bold"
                style={{ background: emp.roleBg, color: emp.roleColor }}
              >
                {emp.role}
              </div>
            </div>
            <div className="text-xs font-medium text-[#1565C0]">
              {emp.mobile}
            </div>
            <div
              className="w-fit rounded-md px-2 py-[3px] text-[11px] font-bold"
              style={{
                color: emp.storeColor,
                background: alpha(emp.storeColor, "15"),
              }}
            >
              {emp.storeCode}
            </div>
            <div className="text-xs text-[#424242]">{emp.storeName}</div>
          </div>
        ))
      )}
    </TableCard>
  );
}

/* ── Server-paginated farmers footer ── */

function FarmerPager({
  page,
  pageCount,
}: {
  page: number;
  pageCount: number;
}) {
  if (pageCount <= 1) return null;
  const prev = Math.max(1, page - 1);
  const next = Math.min(pageCount, page + 1);
  const linkBase =
    "flex h-8 items-center gap-1 rounded-lg border border-line bg-white px-3 text-[12px] font-semibold text-ink-600 hover:bg-surface-150";
  const disabled = "pointer-events-none opacity-40";
  return (
    <div className="mt-3 flex items-center justify-end gap-2">
      <Link
        href={`/master-data?tab=farmers&page=${prev}`}
        scroll={false}
        className={cn(linkBase, page <= 1 && disabled)}
      >
        <ChevronLeft />
        Prev
      </Link>
      <span className="text-[12px] text-ink-muted">
        Page {page} of {pageCount}
      </span>
      <Link
        href={`/master-data?tab=farmers&page=${next}`}
        scroll={false}
        className={cn(linkBase, page >= pageCount && disabled)}
      >
        Next
        <ChevronRight />
      </Link>
    </div>
  );
}

/* ── Root view ── */

export function MasterDataView({
  stores,
  farmers,
  employees,
  initialTab,
  farmerPage,
  farmerPageCount,
  canEdit,
}: {
  stores: StoreRow[];
  farmers: FarmerRow[];
  employees: EmployeeRow[];
  initialTab: MasterDataTab;
  farmerPage: number;
  farmerPageCount: number;
  canEdit: boolean;
}) {
  const [tab, setTab] = useState<MasterDataTab>(initialTab);
  const [detail, setDetail] = useState<
    | { kind: "store"; row: StoreRow }
    | { kind: "farmer"; row: FarmerRow }
    | { kind: "employee"; row: EmployeeRow }
    | null
  >(null);
  const [editStore, setEditStore] = useState<StoreRow | null>(null);
  const [editFarmer, setEditFarmer] = useState<FarmerRow | null>(null);

  return (
    <div className="animate-fadeUp">
      {/* Header */}
      <div className="mb-[22px] flex items-center justify-between">
        <div>
          <div className="text-[22px] font-extrabold text-[#1A1C1A]">
            Master Data Management
          </div>
          <div className="mt-0.5 text-[13px] text-[#757575]">
            Central repository — Stores, Farmers &amp; Employees
          </div>
        </div>
      </div>

      <TabBar active={tab} onChange={setTab} />

      {tab === "stores" && (
        <StoresTable rows={stores} onOpen={(s) => setDetail({ kind: "store", row: s })} />
      )}
      {tab === "farmers" && (
        <>
          <FarmersTable rows={farmers} onOpen={(f) => setDetail({ kind: "farmer", row: f })} />
          <FarmerPager page={farmerPage} pageCount={farmerPageCount} />
        </>
      )}
      {tab === "employees" && (
        <EmployeesTable rows={employees} onOpen={(e) => setDetail({ kind: "employee", row: e })} />
      )}

      {detail && (
        <DetailModal
          detail={detail}
          canEdit={canEdit}
          onClose={() => setDetail(null)}
          onEdit={() => {
            if (detail.kind === "store") setEditStore(detail.row);
            else if (detail.kind === "farmer") setEditFarmer(detail.row);
            setDetail(null);
          }}
        />
      )}
      {editStore && (
        <StoreEditModal store={editStore} onClose={() => setEditStore(null)} />
      )}
      {editFarmer && (
        <FarmerEditModal
          farmer={editFarmer}
          onClose={() => setEditFarmer(null)}
        />
      )}
    </div>
  );
}

/* ── Read-only details modal (all 3 tabs) — reliable render + clear X close ── */

type DetailState =
  | { kind: "store"; row: StoreRow }
  | { kind: "farmer"; row: FarmerRow }
  | { kind: "employee"; row: EmployeeRow };

function detailFields(d: DetailState): { title: string; eyebrow: string; color: string; rows: [string, string][] } {
  if (d.kind === "store") {
    const s = d.row;
    const officers = [s.ao1Name && `${s.ao1Name}${s.ao1Mobile ? ` · ${s.ao1Mobile}` : ""}`, s.ao2Name && `${s.ao2Name}${s.ao2Mobile ? ` · ${s.ao2Mobile}` : ""}`]
      .filter(Boolean).join("\n") || "—";
    return {
      title: s.name, eyebrow: `Store · ${s.code}`, color: s.color,
      rows: [
        ["Code", s.code], ["Store name", s.name], ["Address", s.address || "—"],
        ["Zone / District", s.zone || "—"], ["Agri officer(s)", officers],
        ["BDM", s.bdmName ? `${s.bdmName}${s.bdmMobile ? ` · ${s.bdmMobile}` : ""}` : "—"],
        ["Registered farmers", s.farmerCountLabel], ["Status", s.status],
      ],
    };
  }
  if (d.kind === "farmer") {
    const f = d.row;
    return {
      title: f.name, eyebrow: `Farmer · ${f.code}`, color: f.storeColor,
      rows: [
        ["Code", f.code], ["Name", f.name], ["Mobile", f.mobile || "—"],
        ["Village", f.village || "—"], ["District", f.district || "—"], ["Main crop", f.crop || "—"],
        ["Store", f.storeName || "—"], ["Agri officer", f.aoName || "—"], ["Segment", f.segment || "—"],
      ],
    };
  }
  const e = d.row;
  return {
    title: e.name, eyebrow: `Employee${e.storeCode ? ` · ${e.storeCode}` : ""}`, color: e.storeColor,
    rows: [
      ["Name", e.name], ["Email", e.email || "—"], ["Role", e.role || "—"],
      ["Mobile", e.mobile || "—"], ["Store code", e.storeCode || "—"], ["Store name", e.storeName || "—"],
    ],
  };
}

function DetailModal({ detail, canEdit, onClose, onEdit }: {
  detail: DetailState; canEdit: boolean; onClose: () => void; onEdit: () => void;
}) {
  const { title, eyebrow, color, rows } = detailFields(detail);
  const editable = canEdit && (detail.kind === "store" || detail.kind === "farmer");
  return (
    <Modal open onClose={onClose} className="max-w-[560px]">
      <ModalHeader eyebrow={eyebrow} eyebrowColor={color} title={title} onClose={onClose} />
      <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[10px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]">{k}</dt>
              <dd className="mt-0.5 whitespace-pre-line break-words text-[13px] leading-[1.5] text-[#1A1C1A]">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 flex justify-end gap-2 border-t border-[#F0F0F0] pt-4">
          {editable && (
            <button type="button" onClick={onEdit}
              className="rounded-[10px] bg-brand-600 px-5 py-2 text-[13px] font-semibold text-white hover:bg-brand-700">
              Edit
            </button>
          )}
          <button type="button" onClick={onClose}
            className="rounded-[10px] border-[1.5px] border-[#E0E0E0] px-5 py-2 text-[13px] font-semibold text-[#616161] hover:border-[#9E9E9E]">
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
