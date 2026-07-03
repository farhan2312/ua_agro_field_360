import { prisma } from "@/lib/prisma";
import { avatarColor } from "@/lib/format";
import { shortStoreName, storeColor } from "@/lib/store-utils";
import { SEGMENT_ENUM_TO_LABEL, LEAD_ENUM_TO_LABEL } from "@/lib/segments";
import { MapView } from "@/components/map/MapView";
import type { MapFarmer, MapStore, StoreListItem } from "@/components/map/types";

export const dynamic = "force-dynamic";

/** Whole days between a past date and now (>= 0), or null. */
function daysAgo(d: Date | null | undefined): number | null {
  if (!d) return null;
  const ms = Date.now() - d.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / 86_400_000);
}

export default async function MapViewPage() {
  let farmers: MapFarmer[] = [];
  let stores: MapStore[] = [];
  let allStores: StoreListItem[] = [];
  let categories: string[] = [];

  try {
    // Only farmers with real coordinates are plottable (the 12 enriched demo set).
    const [farmerRows, storeRows] = await Promise.all([
      prisma.farmer.findMany({
        where: { lat: { not: null }, lng: { not: null } },
        select: {
          id: true,
          name: true,
          mobile: true,
          village: true,
          district: true,
          crop: true,
          land: true,
          segment: true,
          leadStatus: true,
          status: true,
          issues: true,
          lat: true,
          lng: true,
          storeId: true,
          visits: {
            orderBy: [{ visitedAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { visitedAt: true, date: true },
          },
        },
        orderBy: { id: "asc" },
      }),
      prisma.store.findMany({
        where: { lat: { not: null }, lng: { not: null } },
        select: {
          id: true,
          code: true,
          name: true,
          lat: true,
          lng: true,
          _count: { select: { farmers: { where: { lat: { not: null } } } } },
        },
        orderBy: { id: "asc" },
      }),
    ]);

    farmers = farmerRows.map((f, i): MapFarmer => {
      const lastVisit = f.visits[0] ?? null;
      const segment = f.segment ? SEGMENT_ENUM_TO_LABEL[f.segment] ?? null : null;
      // Prefer the explicit lead status; fall back to the display `status` string.
      const status = f.leadStatus
        ? LEAD_ENUM_TO_LABEL[f.leadStatus] ?? null
        : f.status ?? null;
      return {
        id: f.id,
        name: f.name,
        mobile: f.mobile,
        village: f.village,
        district: f.district,
        crop: f.crop,
        land: f.land,
        segment,
        status,
        issue: f.issues.length > 0 ? f.issues[0] : null,
        daysSinceVisit: daysAgo(lastVisit?.visitedAt ?? null),
        lastVisit: lastVisit?.date ?? "—",
        lat: f.lat as number,
        lng: f.lng as number,
        storeId: f.storeId,
        avBg: avatarColor(i),
      };
    });

    stores = storeRows.map((s): MapStore => ({
      id: s.id,
      code: s.code,
      name: s.name,
      shortName: shortStoreName(s.name),
      // Use the stored colour if present, else a deterministic palette colour.
      color: storeColor(s.id),
      lat: s.lat as number,
      lng: s.lng as number,
      farmerCount: s._count.farmers,
    }));

    // Every store (alphabetical) for the picker list + distinct sale categories for filtering.
    const [allStoreRows, catRows] = await Promise.all([
      prisma.store.findMany({
        orderBy: { name: "asc" },
        select: {
          id: true,
          code: true,
          name: true,
          zone: true,
          lat: true,
          _count: { select: { farmers: true } },
        },
      }),
      prisma.sale.findMany({
        where: { category: { not: null } },
        distinct: ["category"],
        select: { category: true },
        orderBy: { category: "asc" },
        take: 40,
      }),
    ]);

    allStores = allStoreRows.map((s): StoreListItem => ({
      id: s.id,
      code: s.code,
      name: s.name,
      shortName: shortStoreName(s.name),
      color: storeColor(s.id),
      zone: s.zone,
      farmerCount: s._count.farmers,
      hasGps: s.lat != null,
    }));
    categories = catRows.map((c) => c.category!).filter(Boolean);
  } catch {
    farmers = [];
    stores = [];
    allStores = [];
    categories = [];
  }

  return (
    <MapView
      farmers={farmers}
      stores={stores}
      allStores={allStores}
      categories={categories}
    />
  );
}
