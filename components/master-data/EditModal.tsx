"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalHeader } from "@/components/interactive";
import { SEGMENT_LABELS } from "@/lib/segments";
import { saveStoreAction, saveFarmerAction } from "@/app/actions/master-data";
import type { StoreRow, FarmerRow } from "./types";

/* ── Shared field-control primitives (admin-edit-modal look) ── */

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col">
      <span className="mb-[5px] text-[11px] font-semibold text-[#616161]">
        {label}
      </span>
      {children}
    </label>
  );
}

const controlClass =
  "w-full rounded-[10px] border-[1.5px] border-[#E0E0E0] px-[14px] py-[10px] text-[13px] outline-none focus:border-brand-600";

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={controlClass} />;
}

function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${controlClass} bg-white`} />;
}

/* ── Footer (Cancel / Save) ── */

function Footer({
  onClose,
  saving,
}: {
  onClose: () => void;
  saving: boolean;
}) {
  return (
    <div className="mt-6 flex justify-end gap-[10px] border-t border-[#F0F0F0] pt-[18px]">
      <button
        type="button"
        onClick={onClose}
        className="rounded-[10px] border-[1.5px] border-[#E0E0E0] px-[22px] py-[10px] text-[13px] font-semibold text-[#616161] transition-colors hover:border-[#9E9E9E] hover:text-[#424242]"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={saving}
        className="rounded-[10px] bg-brand-600 px-7 py-[10px] text-[13px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save Changes"}
      </button>
    </div>
  );
}

/* ── Store edit modal ── */

export function StoreEditModal({
  store,
  onClose,
}: {
  store: StoreRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(store.name);
  const [address, setAddress] = useState(store.address);
  const [zone, setZone] = useState(store.zone);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await saveStoreAction({ id: store.id, name, address, zone });
    setSaving(false);
    if (res.ok) {
      router.refresh();
      onClose();
    }
  }

  return (
    <Modal open onClose={onClose} className="max-w-[560px] p-8">
      <ModalHeaderRow
        title={`Edit Store — ${store.name}`}
        sub={store.address || "System Admin · Edit Mode"}
        onClose={onClose}
      />
      <form onSubmit={onSubmit}>
        <div className="flex flex-col gap-[14px]">
          <Field label="Store Name">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Address">
            <TextInput
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </Field>
          <Field label="Zone / District">
            <TextInput value={zone} onChange={(e) => setZone(e.target.value)} />
          </Field>
        </div>
        <Footer onClose={onClose} saving={saving} />
      </form>
    </Modal>
  );
}

/* ── Farmer edit modal ── */

export function FarmerEditModal({
  farmer,
  onClose,
}: {
  farmer: FarmerRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(farmer.name);
  const [mobile, setMobile] = useState(farmer.mobile);
  const [village, setVillage] = useState(farmer.village);
  const [district, setDistrict] = useState(farmer.district);
  const [crop, setCrop] = useState(farmer.crop);
  const [segment, setSegment] = useState(farmer.segment || "");
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await saveFarmerAction({
      id: farmer.id,
      name,
      mobile,
      village,
      district,
      crop,
      segment,
    });
    setSaving(false);
    if (res.ok) {
      router.refresh();
      onClose();
    }
  }

  return (
    <Modal open onClose={onClose} className="max-w-[560px] p-8">
      <ModalHeaderRow
        title={`Edit Farmer — ${farmer.name}`}
        sub={[farmer.village, farmer.mobile].filter(Boolean).join(" · ") || "System Admin · Edit Mode"}
        onClose={onClose}
      />
      <form onSubmit={onSubmit}>
        <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
          <Field label="Farmer Name">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Mobile Number">
            <TextInput
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
            />
          </Field>
          <Field label="Village">
            <TextInput
              value={village}
              onChange={(e) => setVillage(e.target.value)}
            />
          </Field>
          <Field label="District">
            <TextInput
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
            />
          </Field>
          <Field label="Main Crop">
            <TextInput value={crop} onChange={(e) => setCrop(e.target.value)} />
          </Field>
          <Field label="Segment">
            <SelectInput
              value={segment}
              onChange={(e) => setSegment(e.target.value)}
            >
              <option value="">—</option>
              {SEGMENT_LABELS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
        <Footer onClose={onClose} saving={saving} />
      </form>
    </Modal>
  );
}

/* ── Modal header with the orange "SYSTEM ADMIN · EDIT" eyebrow ── */

function ModalHeaderRow({
  title,
  sub,
  onClose,
}: {
  title: string;
  sub: string;
  onClose: () => void;
}) {
  // ModalHeader (shared primitive) renders the eyebrow dot + close button.
  return (
    <div className="-mx-8 -mt-8 mb-[22px]">
      <ModalHeader
        eyebrow="System Admin · Edit"
        eyebrowColor="#E65100"
        title={title}
        subtitle={sub}
        onClose={onClose}
      />
    </div>
  );
}
