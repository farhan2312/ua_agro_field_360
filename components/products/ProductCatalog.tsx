"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Modal, ModalHeader } from "@/components/interactive";
import {
  listProducts, updateProduct, toggleProductActive, mergeProduct, searchProductOptions,
  type ProductVM, type ProductFacets, type ProductFilters,
} from "@/app/actions/products";

const CARD = "rounded-[14px] border border-black/[0.04] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]";
const n = (x: number) => Math.round(x).toLocaleString("en-IN");
const inr = (x: number | null) => (x == null ? "—" : "₹" + Math.round(x).toLocaleString("en-IN"));
const price = (x: number | null) => (x == null ? "—" : "₹" + x.toLocaleString("en-IN", { maximumFractionDigits: 2 }));

const CAT_COLOR: Record<string, string> = {
  "FERTILIZER BULK": "#2E7D32", "FERTILIZER": "#43A047", "SEEDS": "#F9A825",
  "CPC (CROP PROTECTION CHEMICALS)": "#C62828", "MICRO NUTRIENTS": "#1565C0",
  "OTHERS": "#757575", "MECHANICAL SPRAYER": "#6A1B9A", "ELECTRICAL EQUIPMENT": "#00838F",
};
const catColor = (c: string | null) => (c ? CAT_COLOR[c] ?? "#616161" : "#9E9E9E");

export interface CatalogKpis { products: number; revenue: number; qty: number; categories: number }

export function ProductCatalog({ initial, facets, kpis, canEdit }: {
  initial: { rows: ProductVM[]; total: number; page: number; pageSize: number };
  facets: ProductFacets; kpis: CatalogKpis; canEdit: boolean;
}) {
  const [filters, setFilters] = useState<ProductFilters>({ sort: "revenue", page: 1, pageSize: 50 });
  const [data, setData] = useState(initial);
  const [loading, start] = useTransition();
  const [editing, setEditing] = useState<ProductVM | null>(null);
  const [merging, setMerging] = useState<ProductVM | null>(null);

  const load = (f: ProductFilters) => start(async () => setData(await listProducts(f)));
  const set = (patch: Partial<ProductFilters>) => {
    const f = { ...filters, ...patch, page: patch.page ?? 1 };
    setFilters(f); load(f);
  };

  // Debounced search.
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => set({ q: q.trim() || undefined }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const KPIS = [
    ["Products", n(kpis.products)], ["Categories", String(kpis.categories)],
    ["Total revenue", inr(kpis.revenue)], ["Units sold", n(kpis.qty)],
  ] as const;

  return (
    <div className="animate-[fadeUp_0.4s_ease-out]">
      {/* KPI strip */}
      <div className="mb-4 grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        {KPIS.map(([label, val]) => (
          <div key={label} className={`${CARD} p-4`}>
            <div className="text-[11px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]">{label}</div>
            <div className="mt-1 text-[22px] font-bold text-[#1A1C1A]">{val}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className={`${CARD} mb-3 flex flex-wrap items-center gap-2 p-3`}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product…"
          className="min-w-[180px] flex-1 rounded-lg border border-[#E0E0E0] px-3 py-2 text-[13px]" />
        <Select value={filters.mainCategory ?? ""} onChange={(v) => set({ mainCategory: v || undefined })} placeholder="All categories" options={facets.mainCategories} />
        <Select value={filters.subCategory ?? ""} onChange={(v) => set({ subCategory: v || undefined })} placeholder="All sub-categories" options={facets.subCategories} />
        <Select value={filters.cropTag ?? ""} onChange={(v) => set({ cropTag: v || undefined })} placeholder="All crops" options={facets.cropTags} />
        <Select value={filters.uom ?? ""} onChange={(v) => set({ uom: v || undefined })} placeholder="Any unit" options={facets.uoms} />
        <Select value={filters.sort ?? "revenue"} onChange={(v) => set({ sort: v as ProductFilters["sort"] })} placeholder="Sort"
          options={[["revenue", "Top revenue"], ["qty", "Top units"], ["recent", "Recently sold"], ["name", "Name A–Z"]]} />
        {loading && <span className="text-[12px] text-[#9E9E9E]">Updating…</span>}
      </div>

      {/* Table */}
      <div className={`${CARD} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-[#EEE] bg-[#FAFAFA] text-[10px] font-bold uppercase tracking-[0.3px] text-[#9E9E9E]">
                <th className="px-4 py-2.5">Product</th><th>Category</th><th>Crop</th><th className="text-center">Unit</th>
                <th className="text-right">Unit price</th><th className="text-right">Units sold</th><th className="text-right">Revenue</th>
                <th className="text-right">Last sold</th>{canEdit && <th className="text-right px-4">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr><td colSpan={canEdit ? 9 : 8} className="px-4 py-10 text-center text-[13px] text-[#9E9E9E]">No products match.</td></tr>
              ) : data.rows.map((p) => (
                <tr key={p.id} className={`border-b border-[#F5F5F5] ${p.active ? "" : "opacity-50"}`}>
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-[#1A1C1A]">{p.name}</div>
                    {p.name !== p.rawName && <div className="text-[10.5px] text-[#BDBDBD]">{p.rawName}</div>}
                  </td>
                  <td>
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: catColor(p.mainCategory) }}>{p.mainCategory ?? "—"}</span>
                    {p.subCategory && <div className="mt-0.5 text-[10.5px] text-[#9E9E9E]">{p.subCategory}</div>}
                  </td>
                  <td>{p.cropTag ? <span className="rounded-full bg-[#FFF8E1] px-2 py-0.5 text-[10.5px] font-semibold text-[#8D6E00]">{p.cropTag}</span> : <span className="text-[#DDD]">·</span>}</td>
                  <td className="text-center text-[#616161]">{p.uom ?? "—"}</td>
                  <td className="text-right text-[#1A1C1A]">{price(p.avgPrice)}</td>
                  <td className="text-right font-semibold text-[#1A1C1A]">{n(p.totalQty)}</td>
                  <td className="text-right font-bold text-[#2E7D32]">{inr(p.totalRevenue)}</td>
                  <td className="text-right text-[11.5px] text-[#9E9E9E]">{p.lastSoldAt ?? "—"}</td>
                  {canEdit && (
                    <td className="px-4 text-right whitespace-nowrap">
                      <button type="button" onClick={() => setEditing(p)} className="text-[12px] font-semibold text-[#2E7D32] hover:underline">Edit</button>
                      <button type="button" onClick={() => setMerging(p)} className="ml-3 text-[12px] font-semibold text-[#1565C0] hover:underline">Merge</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-[#F0F0F0] px-4 py-2.5 text-[12px] text-[#616161]">
          <div>{n(data.total)} products · page {data.page} / {pages}</div>
          <div className="flex gap-2">
            <button type="button" disabled={data.page <= 1} onClick={() => set({ page: data.page - 1 })} className="rounded-[8px] border border-[#E0E0E0] px-3 py-1 font-semibold disabled:opacity-40">Prev</button>
            <button type="button" disabled={data.page >= pages} onClick={() => set({ page: data.page + 1 })} className="rounded-[8px] border border-[#E0E0E0] px-3 py-1 font-semibold disabled:opacity-40">Next</button>
          </div>
        </div>
      </div>

      {editing && <EditModal product={editing} facets={facets} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(filters); }} />}
      {merging && <MergeModal product={merging} onClose={() => setMerging(null)} onMerged={() => { setMerging(null); load(filters); }} />}
    </div>
  );
}

function Select({ value, onChange, placeholder, options }: {
  value: string; onChange: (v: string) => void; placeholder: string; options: (string | [string, string])[];
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-[#E0E0E0] bg-white px-2.5 py-2 text-[12.5px] text-[#424242]">
      <option value="">{placeholder}</option>
      {options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return <option key={v} value={v}>{l}</option>; })}
    </select>
  );
}

function EditModal({ product, facets, onClose, onSaved }: { product: ProductVM; facets: ProductFacets; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(product.name);
  const [mainCategory, setMain] = useState(product.mainCategory ?? "");
  const [subCategory, setSub] = useState(product.subCategory ?? "");
  const [uom, setUom] = useState(product.uom ?? "");
  const [cropTag, setCrop] = useState(product.cropTag ?? "");
  const [taxRate, setTax] = useState(product.taxRate?.toString() ?? "");
  const [saving, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const save = () => {
    setErr(null);
    start(async () => {
      const res = await updateProduct(product.id, {
        name, mainCategory: mainCategory || null, subCategory: subCategory || null,
        uom: uom || null, cropTag: cropTag || null, taxRate: taxRate === "" ? null : Number(taxRate),
      });
      if (res.ok) onSaved(); else setErr(res.error ?? "Failed");
    });
  };
  const toggle = () => start(async () => { await toggleProductActive(product.id, !product.active); onSaved(); });

  return (
    <Modal open onClose={onClose} className="max-w-[520px]">
      <ModalHeader eyebrow="Product" eyebrowColor="#2E7D32" title="Edit product" subtitle={product.rawName} onClose={onClose} />
      <div className="max-h-[68vh] overflow-y-auto px-5 py-4">
        <Field label="Display name"><input className="w-full rounded-lg border border-[#E0E0E0] px-3 py-2 text-[13px]" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Main category"><EditableSelect value={mainCategory} onChange={setMain} options={facets.mainCategories} /></Field>
          <Field label="Sub category"><EditableSelect value={subCategory} onChange={setSub} options={facets.subCategories} /></Field>
          <Field label="Unit"><EditableSelect value={uom} onChange={setUom} options={facets.uoms} /></Field>
          <Field label="Crop tag"><EditableSelect value={cropTag} onChange={setCrop} options={facets.cropTags} /></Field>
        </div>
        <Field label="GST rate %"><input type="number" className="w-full rounded-lg border border-[#E0E0E0] px-3 py-2 text-[13px]" value={taxRate} onChange={(e) => setTax(e.target.value)} /></Field>
        {err && <div className="mt-1 text-[12px] text-[#C62828]">{err}</div>}
        <div className="mt-4 flex items-center justify-between">
          <button type="button" onClick={toggle} disabled={saving} className={`rounded-[10px] px-3 py-2 text-[12.5px] font-semibold ${product.active ? "bg-[#FDECEA] text-[#C62828]" : "bg-[#E8F5E9] text-[#2E7D32]"}`}>{product.active ? "Deactivate" : "Reactivate"}</button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-[10px] border border-[#E0E0E0] px-4 py-2 text-[13px] font-semibold text-[#616161]">Cancel</button>
            <button type="button" onClick={save} disabled={saving} className="rounded-[10px] bg-[#2E7D32] px-5 py-2 text-[13px] font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function MergeModal({ product, onClose, onMerged }: { product: ProductVM; onClose: () => void; onMerged: () => void }) {
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState<{ id: number; name: string; category: string | null }[]>([]);
  const [target, setTarget] = useState<{ id: number; name: string } | null>(null);
  const [saving, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setOpts([]); return; }
    const t = setTimeout(async () => setOpts(await searchProductOptions(q.trim(), product.id)), 300);
    return () => clearTimeout(t);
  }, [q, product.id]);

  const doMerge = () => {
    if (!target) return;
    setErr(null);
    start(async () => { const res = await mergeProduct(product.id, target.id); if (res.ok) onMerged(); else setErr(res.error ?? "Failed"); });
  };

  return (
    <Modal open onClose={onClose} className="max-w-[520px]">
      <ModalHeader eyebrow="Merge variant" eyebrowColor="#1565C0" title="Merge into another product" subtitle={`"${product.name}" → target`} onClose={onClose} />
      <div className="max-h-[68vh] overflow-y-auto px-5 py-4">
        <p className="mb-3 text-[12.5px] text-[#616161]">All sales of <b>{product.name}</b> move to the product you pick; this one is deactivated. Use to fold duplicate/variant names together.</p>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search target product…" className="w-full rounded-lg border border-[#E0E0E0] px-3 py-2 text-[13px]" />
        <div className="mt-2 max-h-[240px] overflow-y-auto">
          {opts.map((o) => (
            <button key={o.id} type="button" onClick={() => setTarget({ id: o.id, name: o.name })}
              className="flex w-full items-center justify-between rounded-[8px] border-[1.5px] px-3 py-2 text-left text-[12.5px]"
              style={{ borderColor: target?.id === o.id ? "#1565C0" : "#EEE", background: target?.id === o.id ? "#E3F2FD" : "#fff", marginBottom: 6 }}>
              <span className="font-semibold text-[#1A1C1A]">{o.name}</span><span className="text-[11px] text-[#9E9E9E]">{o.category}</span>
            </button>
          ))}
        </div>
        {err && <div className="mt-1 text-[12px] text-[#C62828]">{err}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-[10px] border border-[#E0E0E0] px-4 py-2 text-[13px] font-semibold text-[#616161]">Cancel</button>
          <button type="button" onClick={doMerge} disabled={saving || !target} className="rounded-[10px] bg-[#1565C0] px-5 py-2 text-[13px] font-semibold text-white disabled:opacity-50">{saving ? "Merging…" : target ? `Merge into ${target.name.slice(0, 20)}` : "Pick a target"}</button>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="mb-3"><label className="mb-1 block text-[11px] font-semibold uppercase text-[#9E9E9E]">{label}</label>{children}</div>;
}
function EditableSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-[#E0E0E0] bg-white px-2.5 py-2 text-[13px]">
      <option value="">—</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
