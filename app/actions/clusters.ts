"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { LAYER_LABELS, type MapLayerKey } from "@/lib/map-layers";
import { SEGMENT_ENUM_TO_LABEL, LEAD_ENUM_TO_LABEL } from "@/lib/segments";
import { inr } from "@/lib/format";
import { CLUSTER_PAGE_SIZE, type ClusterMembersResult } from "@/components/clusters/types";

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
      select: { farmerIds: true },
    });
    if (!cluster) return { rows: [], total: 0, page, pageSize: CLUSTER_PAGE_SIZE };

    const ids = cluster.farmerIds;
    const total = ids.length;
    const pageIds = ids.slice((page - 1) * CLUSTER_PAGE_SIZE, page * CLUSTER_PAGE_SIZE);
    if (pageIds.length === 0) return { rows: [], total, page, pageSize: CLUSTER_PAGE_SIZE };

    const [farmers, sums] = await Promise.all([
      prisma.farmer.findMany({
        where: { id: { in: pageIds } },
        select: {
          id: true,
          name: true,
          village: true,
          crop: true,
          land: true,
          segment: true,
          visits: { orderBy: { id: "desc" }, take: 1, select: { date: true } },
        },
      }),
      prisma.sale.groupBy({
        by: ["farmerId"],
        where: { farmerId: { in: pageIds } },
        _sum: { amountNum: true },
      }),
    ]);

    const byId = new Map(farmers.map((f) => [f.id, f]));
    const ltvById = new Map(sums.map((s) => [s.farmerId, s._sum.amountNum ?? 0]));

    // Preserve the stored id order.
    const rows = pageIds
      .map((id) => byId.get(id))
      .filter((f): f is NonNullable<typeof f> => Boolean(f))
      .map((f) => ({
        id: f.id,
        name: f.name,
        village: f.village ?? "—",
        crop: f.crop ?? "—",
        land: f.land ?? 0,
        segment: f.segment ? SEGMENT_ENUM_TO_LABEL[f.segment] ?? "—" : "—",
        lastVisit: f.visits[0]?.date ?? "—",
        ltv: ltvById.get(f.id) ? inr(ltvById.get(f.id)!) : "—",
      }));

    return { rows, total, page, pageSize: CLUSTER_PAGE_SIZE };
  } catch {
    return { rows: [], total: 0, page, pageSize: CLUSTER_PAGE_SIZE };
  }
}
