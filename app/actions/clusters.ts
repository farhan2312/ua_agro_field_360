"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { LAYER_LABELS, type MapLayerKey } from "@/lib/map-layers";
import { SEGMENT_ENUM_TO_LABEL, LEAD_ENUM_TO_LABEL } from "@/lib/segments";
import { segMeta } from "@/lib/campaign-segments";
import { cropLabel } from "@/lib/crops";
import { inr } from "@/lib/format";
import { shortStoreName } from "@/lib/store-utils";
import { getScope, farmerScopeWhere } from "@/lib/scope";
import { CLUSTER_PAGE_SIZE, type ClusterMembersResult } from "@/components/clusters/types";
import { parseCriteria, scopedCriteriaWhere } from "@/lib/cluster-rules";

export interface CreateClusterInput {
  name: string;
  layer: MapLayerKey;
  layerValue: string; // "all" | a specific filter value
  storeCode: string | null;
  seedProject: boolean;
}

export interface CreateClusterResult {
  ok: boolean;
  error?: string;
}

/**
 * Compute the demo farmers matching the chosen layer filter + store, persist a
 * Cluster (with a frozen farmerId snapshot + criteria blob), and optionally seed
 * a PLANNED Project ("<name> — Field Action") from the same member set.
 */
export async function createClusterAction(
  input: CreateClusterInput,
): Promise<CreateClusterResult> {
  const layer = input.layer;
  const layerValue = (input.layerValue || "all").trim();
  const storeCode = input.storeCode || null;

  try {
    // Only the enriched demo farmers carry segment/crop/leadStatus/issues.
    const farmers = await prisma.farmer.findMany({
      where: {
        source: "DEMO",
        ...(storeCode ? { storeCode } : {}),
      },
      select: {
        id: true,
        name: true,
        segment: true,
        crop: true,
        leadStatus: true,
        issues: true,
      },
      orderBy: { id: "asc" },
    });

    const matched = farmers.filter((f) =>
      matchesLayer(layer, layerValue, {
        segment: f.segment ? SEGMENT_ENUM_TO_LABEL[f.segment] : null,
        crop: f.crop,
        leadStatus: f.leadStatus ? LEAD_ENUM_TO_LABEL[f.leadStatus] : null,
        issues: f.issues,
      }),
    );

    const farmerIds = matched.map((f) => f.id);
    const farmerNames = matched.map((f) => f.name);

    const storeName = storeCode
      ? (await prisma.store.findUnique({ where: { code: storeCode }, select: { name: true } }))
          ?.name ?? storeCode
      : "All Stores";

    const layerLabel = LAYER_LABELS[layer];
    const name = input.name.trim() || layerLabel;

    const criteria = JSON.stringify({
      layer,
      layerLabel,
      layerValue,
      store: storeCode,
      storeName,
    });

    await prisma.cluster.create({
      data: {
        name,
        layerFilter: layerValue,
        criteria,
        farmerIds,
        farmerNames,
        source: "DEMO",
      },
    });

    if (input.seedProject) {
      await prisma.project.create({
        data: {
          title: `${name} — Field Action`,
          status: "PLANNED",
          groupName: `${layerLabel}${layerValue !== "all" ? `: ${layerValue}` : ""} · ${storeName}`,
          farmerIds,
          farmerNames,
          source: "DEMO",
        },
      });
    }

    revalidatePath("/clusters");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to create cluster" };
  }
}

/** Mirrors Map View's per-layer match logic against a single farmer. */
function matchesLayer(
  layer: MapLayerKey,
  value: string,
  f: { segment: string | null; crop: string | null; leadStatus: string | null; issues: string[] },
): boolean {
  if (value === "all") return true;
  switch (layer) {
    case "segment":
      return f.segment === value;
    case "crop":
      return f.crop === value;
    case "leadStatus":
      return f.leadStatus === value;
    case "issues":
      if (value === "Active Issues") return f.issues.length > 0;
      if (value === "No Issues") return f.issues.length === 0;
      return true;
    case "lastVisit":
      // lastVisit buckets aren't derivable from stored fields here — keep all.
      return true;
    default:
      return true;
  }
}

/**
 * Fetch a cluster's member farmers (real or demo) on demand, paginated, ordered
 * by the stored id list. Used by the cluster detail panel.
 */
export async function getClusterFarmers(
  clusterId: number,
  page = 1,
): Promise<ClusterMembersResult> {
  try {
    const cluster = await prisma.cluster.findUnique({
      where: { id: clusterId },
      select: { farmerIds: true, criteria: true, mode: true },
    });
    if (!cluster) return { rows: [], total: 0, page, pageSize: CLUSTER_PAGE_SIZE, ltvLabel: "LTV" };

    // RBAC: a scoped viewer (officer→store, RM→region) only ever pages through the
    // members inside their own scope, even for a cluster that spans the country.
    const fScope = farmerScopeWhere(await getScope());
    if (fScope === "none") return { rows: [], total: 0, page, pageSize: CLUSTER_PAGE_SIZE, ltvLabel: "LTV" };

    // Dynamic clusters resolve their rule live; static/legacy use the frozen id snapshot.
    const crit = cluster.mode === "dynamic" ? parseCriteria(cluster.criteria) : null;
    // The crop(s) this cluster was built on (any mode) — used to scope the Crop + LTV columns.
    const cCrit = parseCriteria(cluster.criteria);
    const selectedCrops = [...new Set([...(cCrit?.salesCrops ?? []), ...(cCrit?.cropTags ?? []), ...(cCrit?.visitCrops ?? []), ...(cCrit?.crop ? [cCrit.crop] : [])])];
    const base: Prisma.FarmerWhereInput = crit
      ? scopedCriteriaWhere(crit)
      : { source: "REAL", id: { in: cluster.farmerIds } };
    let total: number;
    let pageIds: number[];
    if (crit || fScope) {
      const where: Prisma.FarmerWhereInput = fScope ? { AND: [base, fScope] } : base;
      const [t, idRows] = await Promise.all([
        prisma.farmer.count({ where }),
        prisma.farmer.findMany({
          where,
          orderBy: { p12mSpend: "desc" },
          skip: (page - 1) * CLUSTER_PAGE_SIZE,
          take: CLUSTER_PAGE_SIZE,
          select: { id: true },
        }),
      ]);
      total = t;
      pageIds = idRows.map((r) => r.id);
    } else {
      const ids = cluster.farmerIds;
      total = ids.length;
      pageIds = ids.slice((page - 1) * CLUSTER_PAGE_SIZE, page * CLUSTER_PAGE_SIZE);
    }
    if (pageIds.length === 0) return { rows: [], total, page, pageSize: CLUSTER_PAGE_SIZE, ltvLabel: selectedCrops.length ? `${selectedCrops.map(cropLabel).join(" + ")} spend` : "LTV" };

    const farmers = await prisma.farmer.findMany({
      where: { id: { in: pageIds } },
      select: {
        id: true,
        name: true,
        village: true,
        salesCropTags: true,
        land: true,
        valueSegment: true,
        lifecycleSegment: true,
        store: { select: { name: true } },
        visits: { orderBy: { id: "desc" }, take: 1, select: { date: true } },
      },
    });

    // LTV = base/pre-tax spend (SaleLine.basic) — crop-scoped to the cluster's crop-tagged lines when it
    // has a crop filter, else all-time base LTV. Never the GST-inclusive bill total.
    const ltvById = new Map<number, number>();
    {
      const rows = await prisma.saleLine.groupBy({
        by: ["farmerId"],
        where: { farmerId: { in: pageIds }, source: "REAL", ...(selectedCrops.length ? { cropTag: { in: selectedCrops } } : {}) },
        _sum: { basic: true },
      });
      for (const r of rows) if (r.farmerId != null) ltvById.set(r.farmerId, Math.round(r._sum.basic ?? 0));
    }
    const byId = new Map(farmers.map((f) => [f.id, f]));

    // Preserve the stored id order.
    const rows = pageIds
      .map((id) => byId.get(id))
      .filter((f): f is NonNullable<typeof f> => Boolean(f))
      .map((f) => ({
        id: f.id,
        name: f.name,
        village: f.village ?? "—",
        crop: selectedCrops.length
          ? ((f.salesCropTags ?? []).filter((c) => selectedCrops.includes(c)).map(cropLabel).join(", ") || selectedCrops.map(cropLabel).join(", "))
          : ((f.salesCropTags ?? []).length ? f.salesCropTags.map(cropLabel).join(", ") : "—"),
        land: f.land ?? 0,
        segment: f.valueSegment ? segMeta(f.valueSegment).label : "—",
        lifecycle: f.lifecycleSegment ? segMeta(f.lifecycleSegment).label : "—",
        lastVisit: f.visits[0]?.date ?? "—",
        ltv: ltvById.get(f.id) ? inr(ltvById.get(f.id)!) : "—",
        store: shortStoreName(f.store?.name) || "—",
      }));

    // When crop-scoped, the spend column is that crop's spend only (not the farmer's overall LTV),
    // so the header must say so — the value/segment tier is still the farmer's OVERALL tier.
    const ltvLabel = selectedCrops.length ? `${selectedCrops.map(cropLabel).join(" + ")} spend` : "LTV";
    return { rows, total, page, pageSize: CLUSTER_PAGE_SIZE, ltvLabel };
  } catch {
    return { rows: [], total: 0, page, pageSize: CLUSTER_PAGE_SIZE, ltvLabel: "LTV" };
  }
}
