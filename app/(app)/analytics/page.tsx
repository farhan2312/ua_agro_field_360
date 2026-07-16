import { notFound } from "next/navigation";
import { getPersona } from "@/lib/session";
import { getScope } from "@/lib/scope";
import { canAccess } from "@/lib/roles";
import { loadOverview } from "@/lib/overview";
import { getWorkbench, getWorkbenchFacets, type WbData, type WbFacets } from "@/app/actions/analytics-segments";
import { AnalyticsWorkbench } from "@/components/analytics/AnalyticsWorkbench";
import { ScopedDashboard, UnassignedDashboard, type ScopedDashboardData } from "@/components/dashboard/ScopedDashboard";

export const dynamic = "force-dynamic";

const EMPTY: WbData = {
  kpis: { farmers: 0, hni: 0, potentialHni: 0, atRisk: 0, lapsed: 0, spend: 0, visits: 0 },
  matrix: { rows: [], totals: {}, grandTotal: 0 },
  segmentDist: [], cropBreakdown: [], extra: [], extraTitle: "", secondary: [], secondaryTitle: "",
};

/**
 * Analytics — the home page. A real, role-scoped overview (absorbed from the old Dashboard:
 * officer→store, RM→region, central/sysadmin→org-wide) on top of the Sales/Visit segmentation
 * workbench: filter → view → save as cluster.
 */
export default async function AnalyticsPage() {
  const [scope, persona] = await Promise.all([getScope(), getPersona()]);
  if (!canAccess("analytics", scope.role)) notFound();

  let overview: ScopedDashboardData | null = null;
  let data = EMPTY;
  let facets: WbFacets = { stores: [], zones: [], salesCrops: [], visitCrops: [], problems: [], spendTiers: [] };
  try {
    [overview, data, facets] = await Promise.all([loadOverview(scope), getWorkbench({ lens: "sales" }), getWorkbenchFacets()]);
  } catch {
    // DB unavailable — render an empty shell.
  }

  // A scoped user with no store/region assigned must see nothing — not global data.
  if (overview == null && (scope.role === "officer" || scope.role === "regional")) {
    return (
      <div className="animate-fadeUp">
        <UnassignedDashboard name={persona.name} kind={scope.role === "officer" ? "store" : "region"} />
      </div>
    );
  }

  return (
    <div className="animate-fadeUp">
      {overview && <ScopedDashboard data={overview} name={persona.name} />}
      <div className="mt-6">
        <div className="mb-3 text-[14px] font-bold text-[#1A1C1A]">Explore — filter, drill in, save as a cluster</div>
        <AnalyticsWorkbench initial={data} facets={facets} />
      </div>
    </div>
  );
}
