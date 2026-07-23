import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getScope, farmerScopeWhere, storeScopeWhere } from "@/lib/scope";
import { getGlobalCropFacet, getGlobalPestFacet } from "@/lib/stats";
import { SEGMENT_COLUMNS, segMeta } from "@/lib/campaign-segments";
import { SPEND_TIERS } from "@/lib/spend-tiers";
import { statusColor } from "@/lib/status";
import { initials, inr, avatarColor } from "@/lib/format";
import { shortStoreName, storeColor } from "@/lib/store-utils";
import { FarmerFilterBar } from "@/components/farmers/FarmerFilterBar";
import { FarmerTable } from "@/components/farmers/FarmerTable";
import { FarmerPagination } from "@/components/farmers/FarmerPagination";
import type { FarmerRowVM, SegFilterVM, FarmerFacetsVM, FarmerSelectedVM } from "@/components/farmers/types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

type SearchParams = {
  q?: string;
  segment?: string;
  store?: string;
  zone?: string;
  crop?: string;
  pest?: string;
  spend?: string;
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
  // Normalise the campaign-segment key from the URL (HNI | POTENTIAL_HNI | …).
  const segKey = sp.segment && SEGMENT_COLUMNS.includes(sp.segment) ? sp.segment : null;
  const storeId = Number.parseInt(sp.store ?? "", 10) || null;
  const zone = (sp.zone ?? "").trim() || null;
  const crop = (sp.crop ?? "").trim() || null;
  const pest = (sp.pest ?? "").trim() || null;
  const spendIdx = /^\d+$/.test(sp.spend ?? "") ? Number(sp.spend) : null;
  const spendTier = spendIdx != null ? SPEND_TIERS[spendIdx] ?? null : null;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  let rows: FarmerRowVM[] = [];
  let total = 0;
  let facets: FarmerFacetsVM = { stores: [], zones: [], crops: [], pests: [], spendTiers: SPEND_TIERS.map((t) => t.label) };

  // RBAC: officers see only their store's farmers, RMs only their region's.
  const scope = await getScope();
  const scopeWhere = farmerScopeWhere(scope);
  const storeWhere = storeScopeWhere(scope);
  if (scopeWhere === "none") {
    // Scoped user with no store/region assigned — fail closed.
    return (
      <div className="animate-[fadeUp_0.4s_ease-out] rounded-[14px] border border-[#FFE0B2] bg-[#FFF8E1] px-4 py-10 text-center text-[13px] text-[#8D6E00]">
        No store or region is assigned to your account yet, so there are no farmers to show. Ask an admin to map you to a store.
      </div>
    );
  }

  try {
    // ── Paginated, filtered farmer table (campaign segments + crop tags)
    const where: Prisma.FarmerWhereInput = {};
    if (segKey) where.campaignSegment = segKey;
    if (storeId) where.storeId = storeId;
    if (zone) where.store = { zone };
    if (crop) where.cropTags = { has: crop };
    if (pest) where.pestTags = { has: pest };
    if (spendTier) {
      where.p12mSpend = {
        ...(spendTier.min != null ? { gte: spendTier.min } : {}),
        ...(spendTier.max != null ? { lt: spendTier.max } : {}),
      };
    }
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { village: { contains: q, mode: "insensitive" } },
        { mobile: { contains: q } },
      ];
    }
    // Scope goes on LAST and as a sibling AND, so no query-string filter can widen it.
    const scopedWhere: Prisma.FarmerWhereInput = scopeWhere ? { AND: [where, scopeWhere] } : where;

    // Dropdown option lists (stores · regions · top crops) — independent of the active
    // filters, but never wider than the caller's scope.
    const [storeOpts, zoneRows, cropRows, pestRows] = await Promise.all([
      prisma.store.findMany({
        where: storeWhere && storeWhere !== "none" ? storeWhere : undefined,
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.store.findMany({
        where: { zone: { not: null }, ...(storeWhere && storeWhere !== "none" ? storeWhere : {}) },
        distinct: ["zone"],
        select: { zone: true },
        orderBy: { zone: "asc" },
      }),
      // Crop tags for the farmers in scope. Officer/RM run a small live scoped query; the
      // unscoped (central/sysadmin) case reuses the cached global facet — the ~130k-row unnest
      // aggregate that was the heaviest repeat query on this page.
      scope.role === "officer" && scope.storeId != null
        ? prisma.$queryRaw<{ crop: string; n: number }[]>(Prisma.sql`
            SELECT unnest("cropTags") crop, COUNT(*)::int n FROM "Farmer"
            WHERE "storeId" = ${scope.storeId} GROUP BY 1 ORDER BY 2 DESC LIMIT 40`).then((r) => r.map((x) => ({ crop: x.crop, count: Number(x.n) })))
        : scope.role === "regional" && scope.zone
          ? prisma.$queryRaw<{ crop: string; n: number }[]>(Prisma.sql`
              SELECT unnest(f."cropTags") crop, COUNT(*)::int n FROM "Farmer" f
              JOIN "Store" s ON s.id = f."storeId"
              WHERE s."zone" = ${scope.zone} GROUP BY 1 ORDER BY 2 DESC LIMIT 40`).then((r) => r.map((x) => ({ crop: x.crop, count: Number(x.n) })))
          : getGlobalCropFacet(),
      // Target pests — same pattern.
      scope.role === "officer" && scope.storeId != null
        ? prisma.$queryRaw<{ pest: string; n: number }[]>(Prisma.sql`
            SELECT unnest("pestTags") pest, COUNT(*)::int n FROM "Farmer"
            WHERE "storeId" = ${scope.storeId} GROUP BY 1 ORDER BY 2 DESC LIMIT 60`).then((r) => r.map((x) => ({ pest: x.pest, count: Number(x.n) })))
        : scope.role === "regional" && scope.zone
          ? prisma.$queryRaw<{ pest: string; n: number }[]>(Prisma.sql`
              SELECT unnest(f."pestTags") pest, COUNT(*)::int n FROM "Farmer" f
              JOIN "Store" s ON s.id = f."storeId"
              WHERE s."zone" = ${scope.zone} GROUP BY 1 ORDER BY 2 DESC LIMIT 60`).then((r) => r.map((x) => ({ pest: x.pest, count: Number(x.n) })))
          : getGlobalPestFacet(),
    ]);
    facets = {
      stores: storeOpts.map((s) => ({ id: s.id, name: shortStoreName(s.name) || s.name })),
      zones: zoneRows.map((z) => z.zone!).filter(Boolean),
      crops: cropRows,
      pests: pestRows,
      spendTiers: SPEND_TIERS.map((t) => t.label),
    };

    const [count, farmers] = await Promise.all([
      prisma.farmer.count({ where: scopedWhere }),
      prisma.farmer.findMany({
        where: scopedWhere,
        orderBy: { id: "asc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          name: true,
          mobile: true,
          village: true,
          cropTags: true,
          campaignSegment: true,
          status: true,
          store: { select: { id: true, name: true } },
          visits: {
            select: { visitedAt: true, date: true },
            orderBy: { visitedAt: "desc" },
            take: 1,
          },
        },
      }),
    ]);
    total = count;

    // LTV for just this page's farmers — one bounded aggregate instead of
    // loading every sale row per farmer via `include`.
    const pageIds = farmers.map((f) => f.id);
    const ltvRows = pageIds.length
      ? await prisma.sale.groupBy({
          by: ["farmerId"],
          where: { farmerId: { in: pageIds } },
          _sum: { amountNum: true },
        })
      : [];
    const ltvById = new Map(ltvRows.map((r) => [r.farmerId, r._sum.amountNum ?? 0]));

    rows = farmers.map((f): FarmerRowVM => {
      const seg = f.campaignSegment && f.campaignSegment !== "OTHER" ? segMeta(f.campaignSegment) : null;

      const ltvNum = ltvById.get(f.id) ?? 0;
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
        crops: f.cropTags.slice(0, 3),
        segment: seg?.label ?? null,
        segBg: seg?.bg ?? "#F5F5F5",
        segColor: seg?.color ?? "#757575",
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
    rows = [];
    total = 0;
  }

  const filters: SegFilterVM[] = [
    { label: "All", value: null, active: segKey === null },
    ...SEGMENT_COLUMNS.map((k) => ({
      label: segMeta(k).label,
      value: k,
      active: segKey === k,
    })),
  ];

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selected: FarmerSelectedVM = {
    store: storeId ? String(storeId) : null,
    zone,
    crop,
    pest,
    spend: spendTier ? String(spendIdx) : null,
  };

  return (
    <div className="animate-[fadeUp_0.4s_ease-out]">
      <FarmerFilterBar search={q} filters={filters} facets={facets} selected={selected} />
      <FarmerTable rows={rows} />
      <FarmerPagination
        page={Math.min(page, pageCount)}
        pageCount={pageCount}
        total={total}
        pageSize={PAGE_SIZE}
      />
    </div>
  );
}
