import { prisma } from "@/lib/prisma";
import { FarmerClustersScreen } from "@/components/clusters/FarmerClustersScreen";
import {
  type ClusterView,
  type ClusterFarmer,
  type StoreOption,
  type ClusterCriteria,
} from "@/components/clusters/types";
import { SEGMENT_ENUM_TO_LABEL, LEAD_ENUM_TO_LABEL } from "@/lib/segments";
import { LAYER_LABELS, type MapLayerKey } from "@/lib/map-layers";

export const dynamic = "force-dynamic";

function fmtCreated(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function parseCriteria(raw: string | null, fallbackLayer: string | null): ClusterCriteria {
  if (raw) {
    try {
      const c = JSON.parse(raw) as Partial<ClusterCriteria>;
      const layer = (c.layer ?? "segment") as MapLayerKey;
      return {
        layer,
        layerLabel: c.layerLabel ?? LAYER_LABELS[layer] ?? "Farmer Segment",
        layerValue: c.layerValue ?? "all",
        store: c.store ?? null,
        storeName: c.storeName ?? "All Stores",
      };
    } catch {
      /* fall through */
    }
  }
  const layer = (fallbackLayer as MapLayerKey) || "segment";
  return {
    layer,
    layerLabel: LAYER_LABELS[layer] ?? "Farmer Segment",
    layerValue: "all",
    store: null,
    storeName: "All Stores",
  };
}

export default async function ClustersPage() {
  let clusters: ClusterView[] = [];
  let farmers: ClusterFarmer[] = [];
  let stores: StoreOption[] = [];

  try {
    const [rawClusters, rawFarmers, rawStores] = await Promise.all([
      prisma.cluster.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.farmer.findMany({
        where: { source: "DEMO" },
        orderBy: { id: "asc" },
        select: {
          id: true,
          name: true,
          village: true,
          crop: true,
          land: true,
          segment: true,
          leadStatus: true,
          issues: true,
          storeCode: true,
          visits: {
            orderBy: { id: "desc" },
            take: 1,
            select: { date: true },
          },
        },
      }),
      prisma.store.findMany({
        orderBy: { name: "asc" },
        select: { code: true, name: true },
      }),
    ]);

    clusters = rawClusters.map((c) => ({
      id: c.id,
      name: c.name,
      criteria: parseCriteria(c.criteria, c.layerFilter),
      farmerIds: c.farmerIds,
      farmerNames: c.farmerNames,
      farmerCount: c.farmerIds.length,
      createdDate: fmtCreated(c.createdAt),
    }));

    farmers = rawFarmers.map((f) => ({
      id: f.id,
      name: f.name,
      village: f.village ?? "—",
      crop: f.crop ?? "—",
      land: f.land ?? 0,
      segment: f.segment ? SEGMENT_ENUM_TO_LABEL[f.segment] ?? "—" : "—",
      leadStatus: f.leadStatus ? LEAD_ENUM_TO_LABEL[f.leadStatus] ?? "—" : "—",
      issues: f.issues ?? [],
      lastVisit: f.visits[0]?.date ?? "—",
      storeCode: f.storeCode ?? null,
    }));

    stores = rawStores;
  } catch {
    clusters = [];
    farmers = [];
    stores = [];
  }

  return <FarmerClustersScreen clusters={clusters} farmers={farmers} stores={stores} />;
}
