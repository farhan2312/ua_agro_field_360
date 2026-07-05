"use client";

import { useState, useTransition } from "react";
import { Modal, ModalHeader } from "@/components/interactive";
import { createStoreAction, updateStoreAction } from "@/app/actions/stores";
import type { StoreMgmtRow, RegionalOption } from "./types";

const STATUSES = ["Active", "Closed", "Vacant", "H.O."];
const labelCls =
  "block text-[11px] font-semibold uppercase tracking-[0.5px] text-ink-muted mb-1.5";
const inputCls =
  "w-full rounded-[10px] border border-line bg-white px-3 py-2.5 text-[13px] text-ink outline-none focus:border-brand-500";

export function StoreFormModal({
  store,
  regionals,
  zones,
  onClose,
}: {
  store: StoreMgmtRow | null;
  regionals: RegionalOption[];
  zones: string[];
  onClose: () => void;
}) {
  const isEdit = !!store;
  const [code, setCode] = useState(store?.code ?? "");
  const [name, setName] = useState(store?.name ?? "");
  const [status, setStatus] = useState(store?.status || "Active");
  const [zone, setZone] = useState(store?.zone ?? "");
  const [regionalManager, setRM] = useState(store?.regionalManager ?? "");
  const [address, setAddress] = useState(store?.address ?? "");
  const [lat, setLat] = useState(store?.lat != null ? String(store.lat) : "");
  const [lng, setLng] = useState(store?.lng != null ? String(store.lng) : "");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setErr(null);
    start(async () => {
      const payload = { code, name, status, zone, address, regionalManager, lat, lng };
      const res = isEdit
        ? await updateStoreAction({ id: store!.id, ...payload })
        : await createStoreAction(payload);
      if (res.ok) onClose();
      else setErr(res.error ?? "Something went wrong.");
    });
  }

  return (
    <Modal open onClose={onClose}>
      <ModalHeader
        eyebrow={isEdit ? "SYSTEM ADMIN · EDIT STORE" : "SYSTEM ADMIN · NEW STORE"}
        title={isEdit ? `Edit Store — ${store!.shortName}` : "Add Store"}
        subtitle={isEdit ? store!.code : "Create a store location"}
        onClose={onClose}
      />
      <div className="px-6 py-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Store Code *</label>
            <input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. AGRO0123" />
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Store Name *</label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Zone / Region</label>
            <input className={inputCls} value={zone} onChange={(e) => setZone(e.target.value)} list="sfm-zones" />
            <datalist id="sfm-zones">
              {zones.map((z) => <option key={z} value={z} />)}
            </datalist>
          </div>
          <div>
            <label className={labelCls}>Regional Manager</label>
            <input className={inputCls} value={regionalManager} onChange={(e) => setRM(e.target.value)} list="sfm-rms" placeholder="name" />
            <datalist id="sfm-rms">
              {regionals.map((r) => <option key={r.id} value={r.name} />)}
            </datalist>
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Address</label>
            <input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Latitude</label>
            <input className={inputCls} inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="optional" />
          </div>
          <div>
            <label className={labelCls}>Longitude</label>
            <input className={inputCls} inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="optional" />
          </div>
        </div>
        <div className="mt-2 text-[10.5px] text-ink-muted">
          Assign agri officers to this store from the store row → <b>Map</b>.
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
            {pending ? "Saving…" : isEdit ? "Save Changes" : "Create Store"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
