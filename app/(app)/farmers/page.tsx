import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  SEGMENT_LABELS,
  SEGMENT_COLORS,
  SEGMENT_BGS,
  SEGMENT_ENUM_TO_LABEL,
  type SegmentLabel,
} from "@/lib/segments";
import { statusColor } from "@/lib/status";
import { initials, inr, avatarColor } from "@/lib/format";
import { shortStoreName, storeColor } from "@/lib/store-utils";
import { SegmentSummaryCards } from "@/components/farmers/SegmentSummaryCards";
import { FarmerFilterBar } from "@/components/farmers/FarmerFilterBar";
import { FarmerTable } from "@/components/farmers/FarmerTable";
import { FarmerPagination } from "@/components/farmers/FarmerPagination";
import type {
  FarmerRowVM,
  SegmentCardVM,
  SegFilterVM,
} from "@/components/farmers/types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

type SearchParams = {
  q?: string;
  segment?: string;
  page?: string;
};

/** Short month-day label from a Date, e.g. "Jun 18". */
function shortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default async function FarmersPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const sp = searchParams ?? {};
  const q = (sp.q ?? "").trim();
  // Normalise the segment enum from the URL (only accept valid enum keys).
  const segEnum =
    sp.segment && sp.segment in SEGMENT_ENUM_TO_LABEL ? sp.segment : null;
  const activeSegment: SegmentLabel | null = segEnum
    ? SEGMENT_ENUM_TO_LABEL[segEnum]
    : null;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  let cards: SegmentCardVM[] = SEGMENT_LABELS.map((label) => ({
    label,
    count: 0,
    color: SEGMENT_COLORS[label],
    revenue: "₹0K total revenue",
  }));
  let rows: FarmerRowVM[] = [];
  let total = 0;
  let registeredTotal = 0;

  try {
    // ── Segment summary cards: counts + revenue over ALL farmers (ignore filters)
    const [segGroups, segRevenue, regCount] = await Promise.all([
      prisma.farmer.groupBy({
        by: ["segment"],
        _count: { _all: true },
      }),
      // Revenue per segment = sum of the segment's farmers' Sale.amountNum.
      prisma.sale.groupBy({
        by: ["farmerId"],
        _sum: { amountNum: true },
      }),
      prisma.farmer.count(),
    ]);
    registeredTotal = regCount;

    const countBySeg = new Map<SegmentLabel, number>();
    for (const g of segGroups) {
      if (!g.segment) continue;
      const label = SEGMENT_ENUM_TO_LABEL[g.segment];
      if (label) countBySeg.set(label, g._count._all);
    }

    // Map farmerId → segment label so we can bucket the revenue sums.
    const enriched = await prisma.farmer.findMany({
      where: { segment: { not: null } },
      select: { id: true, segment: true },
    });
    const segByFarmer = new Map<number, SegmentLabel>();
    for (const f of enriched) {
      if (f.segment) {
        const label = SEGMENT_ENUM_TO_LABEL[f.segment];
        if (label) segByFarmer.set(f.id, label);
      }
    }
    const revBySeg = new Map<SegmentLabel, number>();
    for (const r of segRevenue) {
      const label = segByFarmer.get(r.farmerId);
      if (!label) continue;
      revBySeg.set(label, (revBySeg.get(label) ?? 0) + (r._sum.amountNum ?? 0));
    }

    cards = SEGMENT_LABELS.map((label) => {
      const rev = revBySeg.get(label) ?? 0;
      return {
        label,
        count: countBySeg.get(label) ?? 0,
        color: SEGMENT_COLORS[label],
        revenue: `₹${Math.round(rev / 1000).toLocaleString("en-IN")}K total revenue`,
      };
    });

    // ── Paginated, filtered farmer table
    const where: Prisma.FarmerWhereInput = {};
    if (segEnum) {
      where.segment = segEnum as Prisma.FarmerWhereInput["segment"];
    }
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { village: { contains: q, mode: "insensitive" } },
        { mobile: { contains: q } },
      ];
    }

    const [count, farmers] = await Promise.all([
      prisma.farmer.count({ where }),
      prisma.farmer.findMany({
        where,
        orderBy: { id: "asc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          store: { select: { id: true, name: true } },
          sales: { select: { amountNum: true } },
          visits: {
            select: { visitedAt: true, date: true },
            orderBy: { visitedAt: "desc" },
            take: 1,
          },
        },
      }),
    ]);
    total = count;

    rows = farmers.map((f): FarmerRowVM => {
      const segLabel: SegmentLabel | null = f.segment
        ? SEGMENT_ENUM_TO_LABEL[f.segment] ?? null
        : null;
      const seg = statusColor(segLabel);

      const ltvNum = f.sales.reduce((a, s) => a + (s.amountNum ?? 0), 0);
      const lastVisit = f.visits[0];
      const lastVisitLabel = lastVisit?.visitedAt
        ? shortDate(lastVisit.visitedAt)
        : lastVisit?.date ?? "—";

      const st = statusColor(f.status);
      const storeShort = shortStoreName(f.store?.name);

      return {
        id: f.id,
        name: f.name,
        mobile: f.mobile ?? "",
        village: f.village ?? "",
        crop: f.crop ?? "—",
        segment: segLabel,
        segBg: segLabel ? SEGMENT_BGS[segLabel] : seg.bg,
        segColor: segLabel ? SEGMENT_COLORS[segLabel] : seg.c,
        ltv: ltvNum > 0 ? inr(ltvNum) : "—",
        lastVisit: lastVisitLabel,
        storeName: storeShort || "—",
        storeColor: f.store ? storeColor(f.store.id) : "#9E9E9E",
        status: f.status ?? null,
        statusBg: st.bg,
        statusColor: st.c,
        // Key avatar colour off the stable farmer id (not the filtered index).
        avBg: avatarColor(f.id),
        init: initials(f.name),
      };
    });
  } catch {
    cards = SEGMENT_LABELS.map((label) => ({
      label,
      count: 0,
      color: SEGMENT_COLORS[label],
      revenue: "₹0K total revenue",
    }));
    rows = [];
    total = 0;
    registeredTotal = 0;
  }

  const filters: SegFilterVM[] = [
    { label: "All", value: null, active: activeSegment === null },
    ...SEGMENT_LABELS.map((label) => ({
      label,
      value: label,
      active: activeSegment === label,
    })),
  ];

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="animate-[fadeUp_0.4s_ease-out]">
      <SegmentSummaryCards cards={cards} />
      <FarmerFilterBar search={q} filters={filters} />
      <FarmerTable rows={rows} />
      <FarmerPagination
        page={Math.min(page, pageCount)}
        pageCount={pageCount}
        total={total}
        pageSize={PAGE_SIZE}
      />
      {registeredTotal > 0 && (
        <div className="mt-2 px-1 text-[11px] text-[#BDBDBD]">
          {registeredTotal.toLocaleString("en-IN")} registered farmers · Segmented
          view
        </div>
      )}
    </div>
  );
}
