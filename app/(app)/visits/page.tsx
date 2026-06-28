import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EmptyState } from "@/components/ui";
import { followupNeeded } from "@/lib/visit-types";
import { shortStoreName } from "@/lib/store-utils";
import { avatarColor } from "@/lib/format";
import { VisitKpiStrip } from "@/components/visits-repo/VisitKpiStrip";
import { VisitFilterBar } from "@/components/visits-repo/VisitFilterBar";
import { VisitRow } from "@/components/visits-repo/VisitRow";
import type { VisitRecord } from "@/components/visits-repo/types";

export const dynamic = "force-dynamic";

type SearchParams = {
  officer?: string;
  store?: string;
  type?: string;
  period?: string;
};

const PERIOD_DAYS: Record<string, number | null> = {
  today: 1,
  week: 8,
  month: 32,
  all: null,
};

function periodCutoff(period: string): Date | null {
  const days = PERIOD_DAYS[period] ?? PERIOD_DAYS.month;
  if (days === null || days === undefined) return null;
  // "now" anchored to the live date; window keeps visits newer than (now - days).
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff;
}

export default async function VisitRepoPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const sp = searchParams ?? {};
  const officer = sp.officer ?? "all";
  const store = sp.store ?? "all";
  const type = sp.type ?? "all";
  const period = sp.period && sp.period in PERIOD_DAYS ? sp.period : "month";

  let rows: VisitRecord[] = [];
  let officerOptions: string[] = [];
  let storeOptions: string[] = [];
  let typeOptions: string[] = [];

  try {
    // Build filter options from the full visit set (independent of active filters).
    const [allVisits, allStores] = await Promise.all([
      prisma.visit.findMany({
        select: { officerName: true, purpose: true },
      }),
      prisma.store.findMany({ select: { name: true } }),
    ]);

    officerOptions = Array.from(
      new Set(
        allVisits
          .map((v) => v.officerName)
          .filter((n): n is string => !!n),
      ),
    ).sort();
    typeOptions = Array.from(
      new Set(
        allVisits
          .map((v) => v.purpose)
          .filter((p): p is string => !!p),
      ),
    ).sort();
    storeOptions = Array.from(
      new Set(allStores.map((s) => shortStoreName(s.name)).filter(Boolean)),
    ).sort();

    // Re-query visits with the active filters applied server-side.
    const where: Prisma.VisitWhereInput = {};
    if (officer !== "all") where.officerName = officer;
    if (type !== "all") where.purpose = type;
    const cutoff = periodCutoff(period);
    if (cutoff) where.visitedAt = { gte: cutoff };

    const visits = await prisma.visit.findMany({
      where,
      orderBy: [{ visitedAt: "desc" }, { id: "desc" }],
      include: {
        farmer: {
          select: {
            id: true,
            name: true,
            village: true,
            district: true,
            crop: true,
          },
        },
        store: { select: { id: true, name: true } },
      },
      take: 500,
    });

    rows = visits
      .map((v, i): VisitRecord => {
        const storeFullName = v.store?.name ?? null;
        const storeShort = shortStoreName(storeFullName);
        return {
          id: v.id,
          date: v.date ?? "—",
          farmerName: v.farmer?.name ?? "Unknown farmer",
          village: v.farmer?.village ?? "",
          district: v.farmer?.district ?? "",
          crop: v.farmer?.crop ?? "—",
          officer: v.officerName ?? "—",
          purpose: v.purpose ?? "—",
          storeName: storeShort || "—",
          storeId: v.store?.id ?? null,
          avBg: avatarColor(i),
          needsFollowup: followupNeeded(v.purpose),
        };
      })
      // Store filter matches the short (first-segment) store name, per spec gotcha #1.
      .filter((r) => store === "all" || r.storeName === store);
  } catch {
    rows = [];
    officerOptions = [];
    storeOptions = [];
    typeOptions = [];
  }

  const total = rows.length;
  const followup = rows.filter((r) => r.needsFollowup).length;
  const officers = new Set(rows.map((r) => r.officer).filter((o) => o !== "—")).size;
  const farmers = new Set(rows.map((r) => r.farmerName)).size;

  return (
    <div className="animate-[fadeUp_0.4s_ease-out]">
      <VisitKpiStrip
        total={total}
        followup={followup}
        officers={officers}
        farmers={farmers}
      />

      <VisitFilterBar
        filter={{ officer, store, type, period }}
        options={{ officers: officerOptions, stores: storeOptions, types: typeOptions }}
        total={total}
      />

      <div className="rounded-[14px] border border-black/[0.03] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
        <div className="grid grid-cols-[0.5fr_1.4fr_0.8fr_0.8fr_0.8fr_0.7fr_0.6fr_0.6fr] px-[22px] py-[13px] bg-[#FAFAFA] border-b border-[#F0F0F0] text-[10.5px] font-semibold text-[#9E9E9E] uppercase tracking-[0.5px]">
          <div>Date</div>
          <div>Farmer</div>
          <div>Visit Type</div>
          <div>Officer</div>
          <div>Store</div>
          <div>Crop</div>
          <div>Follow-up</div>
          <div />
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title="No visits found"
            hint="No field visits match the current filters."
          />
        ) : (
          rows.map((r) => (
            <Link key={r.id} href={`/visits/${r.id}`} className="block">
              <VisitRow row={r} />
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
