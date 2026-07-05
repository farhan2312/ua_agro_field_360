"use client";

import { useState, useTransition } from "react";
import { Modal, ModalHeader } from "@/components/interactive";
import { ADMIN_ROLE_CHOICES } from "@/lib/roles";
import { createUserAction, saveUser } from "@/app/actions/users";
import type { UserRow } from "./types";

const labelCls =
  "block text-[11px] font-semibold uppercase tracking-[0.5px] text-ink-muted mb-1.5";
const inputCls =
  "w-full rounded-[10px] border border-line bg-white px-3 py-2.5 text-[13px] text-ink outline-none focus:border-brand-500";

/**
 * System-Admin user form — creates a new account (user == null) or edits an
 * existing one. Mounted only while open, so state resets each time.
 */
export function UserFormModal({
  user,
  onClose,
}: {
  user: UserRow | null;
  onClose: () => void;
}) {
  const isEdit = !!user;
  const [employeeCode, setEmployeeCode] = useState(user?.employeeCode ?? "");
  const [name, setName] = useState(user?.name ?? "");
  const [roleKey, setRoleKey] = useState(user?.roleKey || "officer");
  const [mobile, setMobile] = useState(user?.mobile ?? "");
  const [workEmail, setWorkEmail] = useState(user?.workEmail ?? "");
  const [territory, setTerritory] = useState(user?.territory ?? "");
  const [active, setActive] = useState((user?.status ?? "Active") === "Active");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setErr(null);
    start(async () => {
      const payload = { employeeCode, name, roleKey, mobile, workEmail, territory, active, password };
      const res = isEdit ? await saveUser({ id: user!.id, ...payload }) : await createUserAction(payload);
      if (res.ok) onClose();
      else setErr(res.error ?? "Something went wrong.");
    });
  }

  return (
    <Modal open onClose={onClose}>
      <ModalHeader
        eyebrow={isEdit ? "SYSTEM ADMIN · EDIT" : "SYSTEM ADMIN · NEW USER"}
        title={isEdit ? `Edit User — ${user!.name}` : "Add User"}
        subtitle={isEdit ? user!.email : "Create a login-ready account"}
        onClose={onClose}
      />
      <div className="px-6 py-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Employee Code *</label>
            <input
              className={inputCls}
              value={employeeCode}
              onChange={(e) => setEmployeeCode(e.target.value)}
              placeholder="e.g. UA1234"
            />
          </div>
          <div>
            <label className={labelCls}>Role</label>
            <select className={inputCls} value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
              {ADMIN_ROLE_CHOICES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Full Name *</label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Mobile</label>
            <input
              className={inputCls}
              inputMode="numeric"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
            />
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
            <label className={labelCls}>Work Email</label>
            <input className={inputCls} value={workEmail} onChange={(e) => setWorkEmail(e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Territory / Zone</label>
            <input className={inputCls} value={territory} onChange={(e) => setTerritory(e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>{isEdit ? "Reset Password" : "Default Password"}</label>
            <input
              className={inputCls}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isEdit ? "leave blank to keep current password" : "blank = their mobile number"}
            />
            <div className="mt-1 text-[10.5px] text-ink-muted">
              {isEdit
                ? "Setting a password re-forces a change on their next login."
                : "The user is prompted to change it on first login."}
            </div>
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
            {pending ? "Saving…" : isEdit ? "Save Changes" : "Create User"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
