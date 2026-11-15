/**
 * Campaign location dimensions — Region · District · Village — shared by every campaign page
 * (contact list, matrix, round list, analytics, tracker, Excel exports). Client-safe (no Prisma).
 *
 *   Region   = the zone of the store the farmer was enrolled under (Store.zone — the app-wide "region")
 *   District = Farmer.district
 *   Village  = Farmer.village
 *
 * Values are normalised (trimmed, single-spaced, upper-case) so "Tikaitnagar" and "TIKAITNAGAR " match.
 * A blank value is the empty string and shows as "Not set".
 */

export interface Located { region: string | null; district: string | null; village: string | null }
export interface LocFilter { regions: string[]; districts: string[]; villages: string[] }
/** One distinct location combination with how many farmers have it (filter options for server-side pages). */
export interface LocItem extends Located { n: number }
export interface LocOption { id: string; name: string; count: number }

export const EMPTY_LOC: LocFilter = { regions: [], districts: [], villages: [] };
export const LOC_DIMS = [
  { key: "region", list: "regions", label: "Region", plural: "regions" },
  { key: "district", list: "districts", label: "District", plural: "districts" },
  { key: "village", list: "villages", label: "Village", plural: "villages" },
] as const;
export type LocDim = (typeof LOC_DIMS)[number]["key"];

export function normLoc(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}
/** Normalised value, or null when blank — what the VMs carry. */
export function locVal(s: string | null | undefined): string | null {
  return normLoc(s) || null;
}
export function locLabel(v: string | null | undefined): string {
  return v ? v : "Not set";
}
export function locActive(f: LocFilter | null | undefined): boolean {
  return !!f && (f.regions.length > 0 || f.districts.length > 0 || f.villages.length > 0);
}

/** Pre-built matcher (sets built once — used over tens of thousands of members). */
export function locMatcher(f: LocFilter | null | undefined): (x: Located) => boolean {
  if (!locActive(f)) return () => true;
  const r = new Set(f!.regions), d = new Set(f!.districts), v = new Set(f!.villages);
  return (x) =>
    (!r.size || r.has(normLoc(x.region))) &&
    (!d.size || d.has(normLoc(x.district))) &&
    (!v.size || v.has(normLoc(x.village)));
}

/** Server-side: never trust the client's filter — strings only, normalised, bounded. */
export function sanitizeLoc(f: unknown): LocFilter | null {
  if (!f || typeof f !== "object") return null;
  const o = f as Record<string, unknown>;
  const list = (x: unknown) => (Array.isArray(x) ? [...new Set(x.filter((s): s is string => typeof s === "string").slice(0, 5000).map(normLoc))] : []);
  const out = { regions: list(o.regions), districts: list(o.districts), villages: list(o.villages) };
  return locActive(out) ? out : null;
}

/** "Village · District · Region" for row sub-lines (skips blanks). */
export function locLine(x: Located): string {
  return [x.village, x.district, x.region].filter(Boolean).join(" · ");
}

/** Group located rows into distinct combinations with counts (filter options shipped to the client). */
export function locItemsOf(rows: Located[]): LocItem[] {
  const m = new Map<string, LocItem>();
  for (const x of rows) {
    const region = normLoc(x.region), district = normLoc(x.district), village = normLoc(x.village);
    const k = `${region}\u0001${district}\u0001${village}`;
    const it = m.get(k);
    if (it) it.n++;
    else m.set(k, { region: region || null, district: district || null, village: village || null, n: 1 });
  }
  return [...m.values()];
}

/**
 * Cascading options: regions count across everything; districts only within the picked regions;
 * villages only within the picked regions + districts. "Not set" sorts last.
 */
export function locOptions(items: (Located & { n?: number })[], f: LocFilter): Record<LocDim, LocOption[]> {
  const r = new Set(f.regions), d = new Set(f.districts);
  const acc: Record<LocDim, Map<string, number>> = { region: new Map(), district: new Map(), village: new Map() };
  for (const x of items) {
    const n = x.n ?? 1;
    const region = normLoc(x.region), district = normLoc(x.district), village = normLoc(x.village);
    acc.region.set(region, (acc.region.get(region) ?? 0) + n);
    if (r.size && !r.has(region)) continue;
    acc.district.set(district, (acc.district.get(district) ?? 0) + n);
    if (d.size && !d.has(district)) continue;
    acc.village.set(village, (acc.village.get(village) ?? 0) + n);
  }
  const toOpts = (m: Map<string, number>) =>
    [...m.entries()]
      .map(([id, count]) => ({ id, name: locLabel(id), count }))
      .sort((a, b) => (a.id === "" ? 1 : b.id === "" ? -1 : a.name.localeCompare(b.name)));
  return { region: toOpts(acc.region), district: toOpts(acc.district), village: toOpts(acc.village) };
}

/** After a change, drop picks that no longer exist under the narrowed parent dimension. */
export function pruneLoc(items: (Located & { n?: number })[], f: LocFilter): LocFilter {
  const o = locOptions(items, f);
  const dOk = new Set(o.district.map((x) => x.id));
  const districts = f.districts.filter((x) => dOk.has(x));
  const o2 = locOptions(items, { ...f, districts });
  const vOk = new Set(o2.village.map((x) => x.id));
  return { regions: f.regions, districts, villages: f.villages.filter((x) => vOk.has(x)) };
}

/** Short summary for export headers, e.g. "Region: BARABANKI · District: 2 picked". */
export function locSummary(f: LocFilter | null | undefined): string {
  if (!locActive(f)) return "All locations";
  const part = (label: string, xs: string[]) => (xs.length === 0 ? "" : xs.length <= 3 ? `${label}: ${xs.map(locLabel).join(", ")}` : `${label}: ${xs.length} picked`);
  return [part("Region", f!.regions), part("District", f!.districts), part("Village", f!.villages)].filter(Boolean).join(" · ");
}
