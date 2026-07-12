/**
 * Dynamic cluster rules — one criteria model + resolver for all cluster sources
 * (map filters, HNI/segment matrix, analytics drill). Membership is the LIVE result
 * of running the rule; campaigns snapshot it at launch.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SEGMENT_LABEL_TO_ENUM, LEAD_LABEL_TO_ENUM } from "@/lib/segments";
import { segMeta, CROP_LABEL } from "@/lib/campaign-segments";
import { inr } from "@/lib/format";

/** The rule that defines a cluster. Every field is an AND-ed condition. */
export interface ClusterCriteria {
  storeIds?: number[];
  villages?: string[];
  crop?: string; // farmer.crop (enrichment)
  cropTags?: string[]; // maize / potato (computed) — match ANY
  segment?: string; // legacy display label (High Value…)
  campaignSegment?: string; // single: HNI | AT_RISK | …
  campaignSegments?: string[]; // multiple — match ANY
  leadStatus?: string; // display label
  category?: string; // product category purchased
  spendMin?: number; // p12mSpend >= (₹)
  spendMax?: number; // p12mSpend <  (₹)
  zone?: string;
  district?: string;
  q?: string; // free-text (name/mobile/village/code)
  explicitIds?: number[]; // hand-picked (static clusters)
}

const kFmt = (n: number) => (n >= 1000 ? `₹${n / 1000}K` : `₹${n}`);

/** Turn a criteria rule into a Prisma Farmer `where`. */
export function criteriaToWhere(c: ClusterCriteria): Prisma.FarmerWhereInput {
  const and: Prisma.FarmerWhereInput[] = [];
  if (c.storeIds?.length) and.push({ storeId: { in: c.storeIds } });
  if (c.villages?.length) and.push({ village: { in: c.villages } });
  if (c.crop) and.push({ crop: c.crop });
  if (c.cropTags?.length) and.push({ cropTags: { hasSome: c.cropTags } });
  if (c.campaignSegments?.length) and.push({ campaignSegment: { in: c.campaignSegments } });
  else if (c.campaignSegment) and.push({ campaignSegment: c.campaignSegment });
  if (c.segment && SEGMENT_LABEL_TO_ENUM[c.segment as never])
    and.push({ segment: SEGMENT_LABEL_TO_ENUM[c.segment as never] as never });
  if (c.leadStatus && LEAD_LABEL_TO_ENUM[c.leadStatus as never])
    and.push({ leadStatus: LEAD_LABEL_TO_ENUM[c.leadStatus as never] as never });
  if (c.zone) and.push({ zone: c.zone });
  if (c.district) and.push({ district: c.district });
  if (c.category) and.push({ sales: { some: { category: c.category } } });
  if (c.spendMin != null || c.spendMax != null)
    and.push({ p12mSpend: { ...(c.spendMin != null ? { gte: c.spendMin } : {}), ...(c.spendMax != null ? { lt: c.spendMax } : {}) } });
  if (c.explicitIds?.length) and.push({ id: { in: c.explicitIds } });
  if (c.q?.trim()) {
    const q = c.q.trim();
    and.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { mobile: { contains: q } },
        { village: { contains: q, mode: "insensitive" } },
        { code: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

/** Human-readable summary of the rule (becomes the cluster description). */
export function describeCriteria(c: ClusterCriteria, storeNames?: Map<number, string>): string {
  const parts: string[] = [];
  if (c.storeIds?.length)
    parts.push(c.storeIds.length === 1 ? storeNames?.get(c.storeIds[0]) ?? `Store #${c.storeIds[0]}` : `${c.storeIds.length} stores`);
  if (c.zone) parts.push(c.zone);
  if (c.district) parts.push(c.district);
  if (c.campaignSegments?.length) parts.push(c.campaignSegments.map((s) => segMeta(s).label).join(" / "));
  else if (c.campaignSegment) parts.push(segMeta(c.campaignSegment).label);
  if (c.segment) parts.push(c.segment);
  if (c.crop) parts.push(`Crop: ${c.crop}`);
  if (c.cropTags?.length) parts.push(c.cropTags.map((t) => CROP_LABEL[t] ?? t).join(" + "));
  if (c.leadStatus) parts.push(`Lead: ${c.leadStatus}`);
  if (c.category) parts.push(`Buys: ${c.category}`);
  if (c.spendMin != null && c.spendMax != null) parts.push(`Spend ${kFmt(c.spendMin)}–${kFmt(c.spendMax)}`);
  else if (c.spendMin != null) parts.push(`Spend ${kFmt(c.spendMin)}+`);
  else if (c.spendMax != null) parts.push(`Spend < ${kFmt(c.spendMax)}`);
  if (c.villages?.length) parts.push(`${c.villages.length} village${c.villages.length > 1 ? "s" : ""}`);
  if (c.q?.trim()) parts.push(`"${c.q.trim()}"`);
  if (c.explicitIds?.length) parts.push(`${c.explicitIds.length} hand-picked`);
  return parts.length ? parts.join(" · ") : "All farmers";
}

/** Parse the stored criteria JSON, tolerating the legacy map-builder shape ({storeIds, filters}). */
export function parseCriteria(json: string | null | undefined): ClusterCriteria | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    if (o.layer || o.layerValue) return null; // OG demo-layer shape — not resolvable; use snapshot
    if (o.filters && typeof o.filters === "object")
      return { storeIds: o.storeIds as number[] | undefined, ...(o.filters as ClusterCriteria) };
    return o as ClusterCriteria;
  } catch {
    return null;
  }
}

export interface ClusterFarmerRow {
  id: number;
  name: string;
  mobile: string | null;
  village: string | null;
  segment: string | null;
  spend: string;
  gap: string | null;
  lastItem: string | null;
}

/** Live count of a rule's membership. */
export function resolveClusterCount(c: ClusterCriteria): Promise<number> {
  return prisma.farmer.count({ where: criteriaToWhere(c) });
}

/** Live, paginated membership of a rule. */
export async function resolveClusterFarmers(
  c: ClusterCriteria,
  page = 1,
  pageSize = 25,
): Promise<{ rows: ClusterFarmerRow[]; total: number }> {
  const where = criteriaToWhere(c);
  const [total, farmers] = await Promise.all([
    prisma.farmer.count({ where }),
    prisma.farmer.findMany({
      where,
      orderBy: { p12mSpend: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, name: true, mobile: true, village: true,
        campaignSegment: true, p12mSpend: true, hniGap: true,
        lastMaizeItem: true, lastPotatoItem: true,
      },
    }),
  ]);
  return {
    total,
    rows: farmers.map((f) => ({
      id: f.id,
      name: f.name,
      mobile: f.mobile,
      village: f.village,
      segment: f.campaignSegment,
      spend: f.p12mSpend != null ? inr(f.p12mSpend) : "—",
      gap: f.hniGap != null && f.hniGap > 0 ? inr(f.hniGap) : null,
      lastItem: f.lastMaizeItem ?? f.lastPotatoItem ?? null,
    })),
  };
}

/** Resolve just the ids (for campaign enrolment snapshots). Capped for safety. */
export async function resolveClusterIds(c: ClusterCriteria, cap = 50000): Promise<number[]> {
  const rows = await prisma.farmer.findMany({ where: criteriaToWhere(c), select: { id: true }, take: cap });
  return rows.map((r) => r.id);
}
