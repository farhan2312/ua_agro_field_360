import { prisma } from "@/lib/prisma";
import { avatarColor } from "@/lib/format";
import { shortStoreName, storeColor } from "@/lib/store-utils";
import { SEGMENT_ENUM_TO_LABEL, LEAD_ENUM_TO_LABEL } from "@/lib/segments";
import { MapView } from "@/components/map/MapView";
import type { MapFarmer, MapStore } from "@/components/map/types";

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
  } catch {
    farmers = [];
    stores = [];
  }

  return <MapView farmers={farmers} stores={stores} />;
}
