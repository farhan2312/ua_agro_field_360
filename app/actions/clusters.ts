"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { LAYER_LABELS, type MapLayerKey } from "@/lib/map-layers";
import { SEGMENT_ENUM_TO_LABEL, LEAD_ENUM_TO_LABEL } from "@/lib/segments";

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
