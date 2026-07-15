import { notFound } from "next/navigation";
import { getRole } from "@/lib/session";
import { canAccess } from "@/lib/roles";
import { getWorkbench, getWorkbenchFacets, type WbData, type WbFacets } from "@/app/actions/analytics-segments";
import { AnalyticsWorkbench } from "@/components/analytics/AnalyticsWorkbench";

export const dynamic = "force-dynamic";

const EMPTY: WbData = {
  kpis: { farmers: 0, hni: 0, potentialHni: 0, atRisk: 0, lapsed: 0, spend: 0, visits: 0 },
  matrix: { rows: [], totals: {}, grandTotal: 0 },
  segmentDist: [], cropBreakdown: [], extra: [], extraTitle: "", secondary: [], secondaryTitle: "",
};

/** Analytics — a Sales / Visit segmentation workbench: filter → view → save as segment. */
export default async function AnalyticsPage() {
  const role = await getRole();
  if (!canAccess("analytics", role)) notFound();

  let data = EMPTY;
  let facets: WbFacets = { stores: [], zones: [], salesCrops: [], visitCrops: [], problems: [], spendTiers: [] };
  try {
    [data, facets] = await Promise.all([getWorkbench({ lens: "sales" }), getWorkbenchFacets()]);
  } catch {
    // DB unavailable — render an empty shell.
  }

  return <AnalyticsWorkbench initial={data} facets={facets} />;
}
