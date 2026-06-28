"use client";

import { useState } from "react";
import { ROLE_META, USER_STATUS_META } from "@/lib/status";
import { EmptyState } from "@/components/ui";
import { EditPencil } from "./EditPencil";
import { EditUserModal } from "./EditUserModal";
import type { UserRow } from "./types";

const GRID =
  "grid grid-cols-[1.4fr_1fr_1fr_0.8fr_0.6fr_0.5fr_80px] px-[22px] items-center";

/** Whole user row is dimmed when inactive; visits text greyed. */
function rowColors(status: string) {
  const inactive = status === "Inactive";
  return {
    opacity: inactive ? 0.5 : 1,
    visitsColor: inactive ? "#9E9E9E" : "#1A1C1A",
  };
}

/** Orange when the user has not been active recently (string contains "day"). */
function lastActiveColor(s: string) {
  return /day/i.test(s) ? "#E65100" : "#757575";
}

const ROLE_CARDS: { accent: string; title: string; body: string }[] = [
  {
    accent: "#2E7D32",
    title: "Regional Manager",
    body: "All views, analytics, farmer data, action planner, lead management",
  },
  {
    accent: "#1565C0",
    title: "Agricultural Officer",
    body: "Personal dashboard, new visits, assigned farmers, lead pipeline",
  },
  {
    accent: "#7B1FA2",
    title: "Central Admin",
    body: "Cross-region analytics, all farmers, action planner, user management",
  },
  {
    accent: "#E65100",
    title: "System Admin",
    body: "User management, system settings, master data, audit logs",
  },
];

export function UsersTab({
  rows,
  canEdit,
}: {
  rows: UserRow[];
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState<UserRow | null>(null);

  return (
    <div>
      {/* Header row */}
      <div className="mb-5 flex items-center justify-between">
        <div className="text-[13px] text-[#757575]">
          Manage user accounts, roles, and territory assignments
        </div>
        <button
          type="button"
          className="cursor-pointer rounded-[10px] bg-[#2E7D32] px-[22px] py-[9px] text-[13px] font-semibold text-white hover:bg-[#1B5E20]"
        >
          + Add User
        </button>
      </div>

      {/* Table card */}
      <div className="overflow-hidden rounded-[14px] border border-black/[0.03] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div
          className={`${GRID} border-b border-[#F0F0F0] bg-[#FAFAFA] py-[14px] text-[10.5px] font-semibold uppercase tracking-[0.5px] text-[#9E9E9E]`}
        >
          <div>User</div>
          <div>Role</div>
          <div>Territory</div>
          <div>Last Active</div>
          <div>Visits MTD</div>
          <div>Status</div>
          <div />
        </div>

        {rows.length === 0 ? (
          <EmptyState title="No users yet" hint="Seed the database to see users." />
        ) : (
          rows.map((ur) => {
            const role = ROLE_META[ur.roleLabel] ?? { bg: "#F5F5F5", c: "#757575" };
            const st = USER_STATUS_META[ur.status] ?? { bg: "#F5F5F5", c: "#757575" };
            const { opacity, visitsColor } = rowColors(ur.status);
            return (
              <div
                key={ur.id}
                className={`${GRID} border-b border-[#F8F8F8] py-[14px]`}
                style={{ opacity }}
              >
                {/* User */}
                <div className="flex items-center gap-[10px]">
                  <div
                    className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full text-[12px] font-bold text-white"
                    style={{ background: ur.grad }}
                  >
                    {ur.init}
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold text-[#1A1C1A]">
                      {ur.name}
                    </div>
                    <div className="text-[10.5px] text-[#BDBDBD]">{ur.email}</div>
                  </div>
                </div>
                {/* Role */}
                <div>
                  <span
                    className="inline-block rounded-[20px] px-[10px] py-[3px] text-[10.5px] font-semibold"
                    style={{ background: role.bg, color: role.c }}
                  >
                    {ur.roleLabel}
                  </span>
                </div>
                {/* Territory */}
                <div className="pr-2 text-[12px] text-[#616161]">{ur.territory}</div>
                {/* Last Active */}
                <div className="text-[12px]" style={{ color: lastActiveColor(ur.lastActive) }}>
                  {ur.lastActive}
                </div>
                {/* Visits MTD */}
                <div className="text-[13px] font-bold" style={{ color: visitsColor }}>
                  {ur.visitsMtd}
                </div>
                {/* Status */}
                <div>
                  <span
                    className="inline-block rounded-[20px] px-[10px] py-[3px] text-[10px] font-semibold"
                    style={{ background: st.bg, color: st.c }}
                  >
                    {ur.status}
                  </span>
                </div>
                {/* Actions */}
                <div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => setEditing(ur)}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-[#F5F7F5] px-[10px] py-[5px] text-[11px] font-semibold text-[#2E7D32] hover:bg-[#E8F5E9]"
                    >
                      <EditPencil />
                      Edit
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Role permissions summary */}
      <div className="mt-5 grid grid-cols-4 gap-[14px]">
        {ROLE_CARDS.map((c) => (
          <div
            key={c.title}
            className="rounded-xl border border-black/[0.03] bg-white p-[18px] shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
            style={{ borderTop: `3px solid ${c.accent}` }}
          >
            <div
              className="mb-2 text-[12px] font-bold"
              style={{ color: c.accent }}
            >
              {c.title}
            </div>
            <div className="text-[11px] leading-[1.7] text-[#616161]">{c.body}</div>
          </div>
        ))}
      </div>

      {editing && (
        <EditUserModal user={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
