"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/ui";
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
  canEdit,
  onEdit,
}: {
  rows: StoreRow[];
  canEdit: boolean;
  onEdit: (s: StoreRow) => void;
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
            onClick={canEdit ? () => onEdit(st) : undefined}
            className={cn(
              "grid items-start gap-3 border-b border-[#F5F5F5] px-5 py-3.5 transition-[background] duration-[120ms] hover:bg-[#FAFFF8]",
              canEdit && "cursor-pointer",
            )}
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
  canEdit,
  onEdit,
}: {
  rows: FarmerRow[];
  canEdit: boolean;
  onEdit: (f: FarmerRow) => void;
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
            onClick={canEdit ? () => onEdit(fr) : undefined}
            className={cn(
              "grid items-center gap-2.5 border-b border-[#F5F5F5] px-5 py-3 transition-[background] duration-[120ms] hover:bg-[#FAFFF8]",
              canEdit && "cursor-pointer",
            )}
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

function EmployeesTable({ rows }: { rows: EmployeeRow[] }) {
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
            className="grid items-center gap-3 border-b border-[#F5F5F5] px-5 py-[13px] transition-[background] duration-[120ms] hover:bg-[#FAFFF8]"
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
        <StoresTable rows={stores} canEdit={canEdit} onEdit={setEditStore} />
      )}
      {tab === "farmers" && (
        <>
          <FarmersTable
            rows={farmers}
            canEdit={canEdit}
            onEdit={setEditFarmer}
          />
          <FarmerPager page={farmerPage} pageCount={farmerPageCount} />
        </>
      )}
      {tab === "employees" && <EmployeesTable rows={employees} />}

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
