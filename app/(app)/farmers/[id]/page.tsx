import { notFound } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getRole } from "@/lib/session";
import { getScope, farmerScopeWhere } from "@/lib/scope";
import { LEAD_ENUM_TO_LABEL } from "@/lib/segments";
import { segMeta } from "@/lib/campaign-segments";
import { inr } from "@/lib/format";
import { storeColor } from "@/lib/store-utils";
import { BackLink } from "@/components/farmer-detail/BackLink";
import { FarmerProfileCard } from "@/components/farmer-detail/FarmerProfileCard";
import { StoreAssignmentCard } from "@/components/farmer-detail/StoreAssignmentCard";
import { KpiMini } from "@/components/farmer-detail/KpiMini";
import { SalesHistoryCard } from "@/components/farmer-detail/SalesHistoryCard";
import { VisitReportsCard } from "@/components/farmer-detail/VisitReportsCard";
import { ConcernsCard } from "@/components/farmer-detail/ConcernsCard";
import type { FarmerDetail } from "@/components/farmer-detail/types";

export const dynamic = "force-dynamic";

const FALLBACK_SEG_BG = "#F5F5F5";
const FALLBACK_SEG_COLOR = "#757575";

/** ISO "YYYY-MM-DD" → "12 Aug 2026" for display (empty string when unset). */
function fmtFollowUp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function buildDetail(
  farmer: NonNullable<Awaited<ReturnType<typeof loadFarmer>>>,
): FarmerDetail {
  const vMeta = farmer.valueSegment ? segMeta(farmer.valueSegment) : null;
  const lMeta = farmer.lifecycleSegment ? segMeta(farmer.lifecycleSegment) : null;
  const statusLabel = farmer.leadStatus
    ? LEAD_ENUM_TO_LABEL[farmer.leadStatus] ?? ""
    : farmer.status ?? "";

  const sales = farmer.sales.map((s) => ({
    id: s.id,
    invoice: s.invoice ?? "",
    date: s.date ?? "",
    items: s.items ?? "",
    amount: s.amount ?? "",
    store: s.store ?? "",
  }));

  const visitLog = farmer.visits.map((v) => ({
    id: v.id,
    purpose: v.purpose ?? v.type ?? "Field Visit",
    date: v.date ?? "",
    notes: v.notes ?? "",
    by: v.officerName ?? "",
    followUp: fmtFollowUp(v.followUpDate),
  }));

  // Computed lifetime value from numeric amounts (falls back to ₹0).
  const ltvNum = farmer.sales.reduce((sum, s) => sum + (s.amountNum ?? 0), 0);

  const store = farmer.store
    ? {
        name: farmer.store.name,
        code: farmer.store.code,
        color: storeColor(farmer.store.id),
        address: farmer.store.address ?? "",
        officers: farmer.store.employees.map((e) => ({ name: e.name })),
      }
    : null;

  return {
    id: farmer.id,
    name: farmer.name,
    village: farmer.village ?? "",
    district: farmer.district ?? "",
    mobile: farmer.mobile ?? "",
    land: farmer.land != null ? String(farmer.land) : "",
    crop: farmer.crop ?? "",
    season: "",
    soil: "",
    status: statusLabel,
    segment: vMeta?.label ?? "",
    segBg: vMeta?.bg ?? FALLBACK_SEG_BG,
    segColor: vMeta?.color ?? FALLBACK_SEG_COLOR,
    lifecycle: lMeta?.label ?? "",
    lifeBg: lMeta?.bg ?? FALLBACK_SEG_BG,
    lifeColor: lMeta?.color ?? FALLBACK_SEG_COLOR,
    salesCrops: farmer.salesCropTags ?? [],
    visitCrops: farmer.visitCropTags ?? [],
    ltv: inr(ltvNum),
    saleCount: sales.length,
    visitCount: visitLog.length,
    lastPurchaseAmt: sales[0]?.amount || "—",
    lastPurchaseDate: sales[0]?.date || "No purchases",
    store,
    sales,
    visitLog,
    concerns: farmer.concerns ?? "",
    issues: farmer.issues ?? [],
  };
}

/** RBAC: the id lookup is AND-ed with the caller's scope, so an out-of-store /
 *  out-of-region farmer 404s instead of opening by direct URL. */
async function loadFarmer(id: number, scopeWhere: Prisma.FarmerWhereInput | null) {
  return prisma.farmer.findFirst({
    where: scopeWhere ? { AND: [{ id }, scopeWhere] } : { id },
    include: {
      store: { include: { employees: { take: 2, orderBy: { id: "asc" } } } },
      sales: { orderBy: [{ soldAt: "desc" }, { id: "desc" }], take: 60 },
      visits: { orderBy: { id: "desc" } },
    },
  });
}

export default async function FarmerDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) notFound();

  const isAdmin = (await getRole()) === "sysadmin";
  const scopeWhere = farmerScopeWhere(await getScope());
  if (scopeWhere === "none") notFound(); // scoped user with no store/region — fail closed

  let farmer: Awaited<ReturnType<typeof loadFarmer>> = null;
  try {
    farmer = await loadFarmer(id, scopeWhere);
  } catch {
    farmer = null; // DB unavailable pre-seed — fall through to not-found shell.
  }

  if (!farmer) notFound();

  const detail = buildDetail(farmer);

  // Accurate lifetime value + invoice count across ALL bills (the list above is capped).
  try {
    const agg = await prisma.sale.aggregate({
      where: { farmerId: id },
      _sum: { amountNum: true },
      _count: { _all: true },
    });
    if (agg._count._all > 0) {
      detail.ltv = inr(agg._sum.amountNum ?? 0);
      detail.saleCount = agg._count._all;
    }
  } catch {
    // keep the from-list computation on error
  }

  return (
    <div className="animate-fadeUp">
      <BackLink />

      {/* Top grid — Profile + Store + 2 KPI minis */}
      <div className="grid grid-cols-1 gap-4 mb-[18px] sm:grid-cols-2 lg:grid-cols-4">
        <FarmerProfileCard farmer={detail} />
        {detail.store && <StoreAssignmentCard store={detail.store} />}
        <KpiMini
          label="Lifetime Value"
          value={detail.ltv}
          valueColor="#2E7D32"
          sub={`${detail.saleCount} invoices`}
        />
        <KpiMini
          label="Last Purchase"
          value={detail.lastPurchaseAmt}
          valueColor="#1A1C1A"
          sub={detail.lastPurchaseDate}
        />
      </div>

      {/* Middle grid — Sales History + Visit Log */}
      <div className="grid grid-cols-1 gap-[18px] mb-[18px] lg:grid-cols-[1.2fr_1fr]">
        <SalesHistoryCard sales={detail.sales} />
        <VisitReportsCard visits={detail.visitLog} count={detail.visitCount} />
      </div>

      {(detail.concerns || detail.issues.length > 0 || isAdmin) && (
        <ConcernsCard concerns={detail.concerns} issues={detail.issues} />
      )}
    </div>
  );
}
