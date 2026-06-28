"use client";

import { useState, useTransition } from "react";
import { Modal, ModalHeader } from "@/components/interactive";
import { saveUser } from "@/app/actions/users";
import type { UserRow } from "./types";

const ROLE_OPTIONS = [
  "Regional Manager",
  "Agri Officer",
  "Central Admin",
  "System Admin",
];

const labelCls =
  "block text-[11px] font-semibold uppercase tracking-[0.5px] text-ink-muted mb-1.5";
const inputCls =
  "w-full rounded-[10px] border border-line bg-white px-3 py-2.5 text-[13px] text-ink outline-none focus:border-brand-500";

export function EditUserModal({
  user,
  onClose,
}: {
  user: UserRow | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(user?.name ?? "");
  const [role, setRole] = useState(user?.roleLabel ?? "");
  const [territory, setTerritory] = useState(user?.territory ?? "");
  const [active, setActive] = useState((user?.status ?? "Active") === "Active");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!user) return null;

  function submit() {
    if (!user) return;
    setErr(null);
    start(async () => {
      const res = await saveUser({
        id: user.id,
        name,
        roleLabel: role,
        territory,
        active,
      });
      if (res.ok) onClose();
      else setErr(res.error ?? "Save failed");
    });
  }

  return (
    <Modal open onClose={onClose}>
      <ModalHeader
        eyebrow="SYSTEM ADMIN · EDIT"
        title={`Edit User — ${user.name}`}
        subtitle={user.email}
        onClose={onClose}
      />
      <div className="px-6 py-5">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className={labelCls}>Name</label>
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Role</label>
            <select
              className={inputCls}
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              {!ROLE_OPTIONS.includes(role) && role && (
                <option value={role}>{role}</option>
              )}
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select
              className={inputCls}
              value={active ? "Active" : "Inactive"}
              onChange={(e) => setActive(e.target.value === "Active")}
            >
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Territory</label>
            <input
              className={inputCls}
              value={territory}
              onChange={(e) => setTerritory(e.target.value)}
            />
          </div>
        </div>

        {err && <div className="mt-3 text-[12px] text-danger">{err}</div>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-[10px] border border-line bg-white px-[18px] py-[9px] text-[13px] font-semibold text-ink-600 hover:bg-surface-150 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="rounded-[10px] bg-[#2E7D32] px-[22px] py-[9px] text-[13px] font-semibold text-white hover:bg-[#1B5E20] disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
