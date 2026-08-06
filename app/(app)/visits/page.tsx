import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getScope, visitScopeWhere, storeScopeWhere } from "@/lib/scope";
import { EmptyState } from "@/components/ui";
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

  // RBAC: officers see only their store's visits, RMs only their region's.
  const scope = await getScope();
  const scopeWhere = visitScopeWhere(scope);
  const storeWhere = storeScopeWhere(scope);
  if (scopeWhere === "none") {
    return (
      <div className="animate-[fadeUp_0.4s_ease-out] rounded-[14px] border border-[#FFE0B2] bg-[#FFF8E1] px-4 py-10 text-center text-[13px] text-[#8D6E00]">
        No store or region is assigned to your account yet, so there are no visits to show. Ask an admin to map you to a store.
      </div>
    );
  }

  try {
    // Filter option lists (independent of active filters, but never wider than scope).
    // DISTINCT queries so these read only the unique officer/purpose values.
    const [officerRows, typeRows, allStores] = await Promise.all([
      prisma.visit.findMany({
        where: scopeWhere ? { AND: [{ officerName: { not: null } }, scopeWhere] } : { officerName: { not: null } },
        select: { officerName: true },
        distinct: ["officerName"],
        orderBy: { officerName: "asc" },
      }),
      prisma.visit.findMany({
        where: scopeWhere ? { AND: [{ purpose: { not: null } }, scopeWhere] } : { purpose: { not: null } },
        select: { purpose: true },
        distinct: ["purpose"],
        orderBy: { purpose: "asc" },
      }),
      prisma.store.findMany({
        where: storeWhere && storeWhere !== "none" ? storeWhere : undefined,
        select: { name: true },
      }),
    ]);

    officerOptions = officerRows
      .map((v) => v.officerName)
      .filter((n): n is string => !!n);
    typeOptions = typeRows
      .map((v) => v.purpose)
      .filter((p): p is string => !!p);
    storeOptions = Array.from(
      new Set(allStores.map((s) => shortStoreName(s.name)).filter(Boolean)),
    ).sort();

    // Re-query visits with the active filters applied server-side.
    const where: Prisma.VisitWhereInput = {};
    if (officer !== "all") where.officerName = officer;
    if (type !== "all") where.purpose = type;
    const cutoff = periodCutoff(period);
    if (cutoff) where.visitedAt = { gte: cutoff };
    // Scope goes on LAST so no query-string filter can widen it.
    const scopedWhere: Prisma.VisitWhereInput = scopeWhere ? { AND: [where, scopeWhere] } : where;

    const visits = await prisma.visit.findMany({
      where: scopedWhere,
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
          crop: v.mainCrop || v.farmer?.crop || "—",
          land: v.landHoldingUnit ?? "",
          officer: v.officerName ?? "—",
          purpose: v.purpose ?? "—",
          storeName: storeShort || "—",
          storeId: v.store?.id ?? null,
          avBg: avatarColor(i),
          needsFollowup: !!v.followUpDate,
          followUp: v.followUpDate
            ? (() => { const d = new Date(`${v.followUpDate}T00:00:00`); return Number.isNaN(d.getTime()) ? v.followUpDate! : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); })()
            : "",
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
        <div className="overflow-x-auto">
        <div className="min-w-[960px] lg:min-w-0">
        <div className="grid grid-cols-[0.5fr_1.4fr_0.8fr_0.8fr_0.8fr_0.6fr_0.6fr_0.7fr_0.5fr] px-[22px] py-[13px] bg-[#FAFAFA] border-b border-[#F0F0F0] text-[10.5px] font-semibold text-[#9E9E9E] uppercase tracking-[0.5px]">
          <div>Date</div>
          <div>Farmer</div>
          <div>Visit Type</div>
          <div>Officer</div>
          <div>Store</div>
          <div>Crop</div>
          <div>Land</div>
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
      </div>
    </div>
  );
}
