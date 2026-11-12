/**
 * Builder rules for where a field lands on a visual (click = sensible slot, drop = chosen well) and how
 * fields carry over when a visual changes type. Pure functions, client-safe.
 */
import { DATASET_BY_ID, fieldMeta, valueFormat } from "./model";
import { VISUAL_META, type Visual, type VisualType, type ValueRef } from "./types";

export type Well = "axis" | "split" | "dims" | "values";
type Out = { visual: Visual } | { error: string };

const hasSplit = (t: VisualType) => !!VISUAL_META[t].split;
const hasAxis = (t: VisualType) => !!VISUAL_META[t].axis;

/** The dataset's first ready-made measure (used when a chart has an axis but nothing to measure). */
export function defaultMeasure(ds: string): ValueRef | null {
  const f = DATASET_BY_ID[ds]?.fields.find((x) => x.kind === "measure");
  return f ? { field: f.id } : null;
}

/** Keep a visual's wells consistent with its type (and give charts a measure). */
export function normalize(v: Visual): Visual {
  const meta = VISUAL_META[v.type];
  const out: Visual = { ...v, values: v.values.slice(0, meta.maxValues) };
  if (!hasAxis(v.type)) out.axis = null;
  if (!hasSplit(v.type)) out.split = null;
  if (v.type !== "table") out.dims = undefined;
  if (out.split && out.values.length > 1) out.values = out.values.slice(0, 1);
  if (out.dataset && v.type !== "table" && !out.values.length && (out.axis || v.type === "kpi")) {
    const m = defaultMeasure(out.dataset);
    if (m) out.values = [m];
  }
  return out;
}

export function placeField(v: Visual, ds: string, fieldId: string, well?: Well): Out {
  if (v.dataset && v.dataset !== ds) return { error: `This visual uses “${DATASET_BY_ID[v.dataset]?.label}”. Pick a field from it, or add a new visual for “${DATASET_BY_ID[ds]?.label}”.` };
  const f = fieldMeta(ds, fieldId);
  if (!f) return { error: "Unknown field." };
  const next: Visual = { ...v, dataset: ds, values: [...v.values], dims: v.dims ? [...v.dims] : v.type === "table" ? [] : undefined };
  const asDim = { field: fieldId, grain: f.date ? ("month" as const) : undefined };
  const asValue: ValueRef = f.kind === "measure" ? { field: fieldId } : f.kind === "num" ? { field: fieldId, agg: f.defaultAgg ?? "sum" } : { field: fieldId, agg: "distinct" };

  const putValue = (): string | null => {
    const max = VISUAL_META[v.type].maxValues;
    if (v.type !== "table" && next.values.length) {
      const fmt = valueFormat(ds, asValue);
      if (next.values.some((x) => valueFormat(ds, x) !== fmt) || valueFormat(ds, next.values[0]) !== fmt) {
        if (max === 1) { next.values = [asValue]; return null; }
        return "That value uses different units from the one already here — add it to a new visual so the chart keeps one scale.";
      }
    }
    if (next.split && v.type !== "table" && next.values.length >= 1) { next.values = [asValue]; return null; }
    if (next.values.length >= max) next.values[max - 1] = asValue; else next.values.push(asValue);
    return null;
  };

  let target = well;
  if (!target) {
    if (f.kind !== "dim") target = "values";
    else if (v.type === "kpi") target = "values";
    else if (v.type === "table") target = "dims";
    else if (!next.axis) target = "axis";
    else if (hasSplit(v.type) && !next.split && next.values.length <= 1) target = "split";
    else target = "axis";
  }

  if (target === "values") { const e = putValue(); if (e) return { error: e }; }
  else {
    if (f.kind !== "dim") return { error: "Numbers go in Values — drop a category or date here." };
    if (target === "axis") { if (!hasAxis(v.type)) return { error: "This visual has no axis." }; next.axis = asDim; }
    if (target === "split") { if (!hasSplit(v.type)) return { error: "This visual can’t be split." }; next.split = asDim; }
    if (target === "dims") { if (v.type !== "table") return { error: "Only tables take row fields." }; if ((next.dims ?? []).length >= 4) next.dims![3] = asDim; else next.dims!.push(asDim); }
  }
  return { visual: normalize(next) };
}

/** Change a visual's type, carrying its fields over where they fit. */
export function changeType(v: Visual, type: VisualType): Visual {
  const dims = v.type === "table" ? v.dims ?? [] : ([v.axis, v.split].filter(Boolean) as NonNullable<Visual["axis"]>[]);
  const next: Visual = { ...v, type };
  if (type === "table") { next.dims = dims.slice(0, 4); next.axis = null; next.split = null; }
  else { next.axis = dims[0] ?? null; next.split = hasSplit(type) ? dims[1] ?? null : null; }
  return normalize(next);
}

/** The visual a field creates when dropped on empty canvas (numbers → KPI, dates → line, categories → bar). */
export function typeForField(ds: string, fieldId: string): VisualType {
  const f = fieldMeta(ds, fieldId);
  if (!f || f.kind !== "dim") return "kpi";
  return f.date ? "line" : "bar";
}
