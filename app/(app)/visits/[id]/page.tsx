import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { initials, avatarColor } from "@/lib/format";
import { shortStoreName, storeColor } from "@/lib/store-utils";
import {
  SEGMENT_ENUM_TO_LABEL,
  SEGMENT_COLORS,
  SEGMENT_BGS,
  type SegmentLabel,
} from "@/lib/segments";
import {
  visitTypeColor,
  followupNeeded,
  recommendationsFor,
} from "@/lib/visit-types";
import { VisitDetailView, type VisitDetailData } from "@/components/visit-detail/VisitDetailView";

export const dynamic = "force-dynamic";

type VisitRow = {
  id: number;
  date: string | null;
  visitedAt: Date | null;
  purpose: string | null;
  notes: string | null;
  officerName: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
  segment: string | null;
  farmer: {
    id: number;
    name: string;
    mobile: string | null;
    village: string | null;
    district: string | null;
    crop: string | null;
    land: number | null;
    segment: string | null;
  } | null;
  store: { id: number; name: string } | null;
};

function gpsString(lat: number | null, lng: number | null): { text: string; verified: boolean } {
  if (lat != null && lng != null) {
    const ns = lat >= 0 ? "N" : "S";
    const ew = lng >= 0 ? "E" : "W";
    return {
      text: `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lng).toFixed(4)}° ${ew} · Verified`,
      verified: true,
    };
  }
  return { text: "Not captured", verified: false };
}

export default async function VisitDetailPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  let visit: VisitRow | null = null;
  let dbError = false;
  try {
    visit = (await prisma.visit.findUnique({
      where: { id },
      select: {
        id: true,
        date: true,
        visitedAt: true,
        purpose: true,
        notes: true,
        officerName: true,
        gpsLat: true,
        gpsLng: true,
        segment: true,
        farmer: {
          select: {
            id: true,
            name: true,
            mobile: true,
            village: true,
            district: true,
            crop: true,
            land: true,
            segment: true,
          },
        },
        store: { select: { id: true, name: true } },
      },
    })) as VisitRow | null;
  } catch {
    dbError = true;
  }

  if (dbError) {
    // DB unavailable (pre-seed) — render an empty-but-valid layout rather than crashing.
    const empty: VisitDetailData = {
      vid: `VIS-${String(id).padStart(4, "0")}`,
      date: "",
      purpose: "",
      notes: "",
      officer: "",
      village: "",
      district: "",
      crop: "",
      land: "",
      segment: "",
      storeName: "",
      typeColor: visitTypeColor(null),
      storeColor: "#9E9E9E",
      followup: "None",
      followupBg: "#E8F5E9",
      followupColor: "#2E7D32",
      segBg: "#F5F5F5",
      segColor: "#757575",
      farmerName: "",
      farmerMobile: "",
      init: "",
      avatarBg: "#2E7D32",
      farmerId: null,
      recs: recommendationsFor(null),
      gps: "Not captured",
      gpsVerified: false,
      year: "",
    };
    return <VisitDetailView data={empty} />;
  }

  if (!visit) notFound();

  // Segment: prefer the visit's own segment, fall back to the farmer's.
  const segEnum = visit.segment ?? visit.farmer?.segment ?? null;
  const segLabel: SegmentLabel | "" = segEnum
    ? SEGMENT_ENUM_TO_LABEL[segEnum] ?? ""
    : "";

  const needsFollowup = followupNeeded(visit.purpose);
  const year = visit.visitedAt ? String(visit.visitedAt.getFullYear()) : "2026";

  const gps = gpsString(visit.gpsLat, visit.gpsLng);

  const data: VisitDetailData = {
    vid: `VIS-${String(visit.id).padStart(4, "0")}`,
    date: visit.date ?? "",
    purpose: visit.purpose ?? "",
    notes: visit.notes ?? "",
    officer: visit.officerName ?? "",
    village: visit.farmer?.village ?? "",
    district: visit.farmer?.district ?? "",
    crop: visit.farmer?.crop ?? "",
    land: visit.farmer?.land != null ? String(visit.farmer.land) : "",
    segment: segLabel,
    storeName: shortStoreName(visit.store?.name),
    typeColor: visitTypeColor(visit.purpose),
    storeColor: visit.store ? storeColor(visit.store.id) : "#9E9E9E",
    followup: needsFollowup ? "Needed" : "None",
    followupBg: needsFollowup ? "#FFF3E0" : "#E8F5E9",
    followupColor: needsFollowup ? "#E65100" : "#2E7D32",
    segBg: segLabel ? SEGMENT_BGS[segLabel] : "#F5F5F5",
    segColor: segLabel ? SEGMENT_COLORS[segLabel] : "#757575",
    farmerName: visit.farmer?.name ?? "",
    farmerMobile: visit.farmer?.mobile ?? "",
    init: visit.farmer ? initials(visit.farmer.name) : "",
    avatarBg: avatarColor(visit.farmer?.id ?? visit.id),
    farmerId: visit.farmer?.id ?? null,
    recs: recommendationsFor(visit.purpose),
    gps: gps.text,
    gpsVerified: gps.verified,
    year,
  };

  return <VisitDetailView data={data} />;
}
