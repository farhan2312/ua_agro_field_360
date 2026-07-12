import { getAnalytics, type AnalyticsData } from "@/lib/analytics";
import { PeriodFilter } from "@/components/analytics/PeriodFilter";
import { HeroKpiBanner } from "@/components/analytics/HeroKpiBanner";
import { ProblemHeatmap } from "@/components/analytics/ProblemHeatmap";
import { AsrLeaderboard } from "@/components/analytics/AsrLeaderboard";
import { RegionalPerformance } from "@/components/analytics/RegionalPerformance";
import { ConversionFunnel } from "@/components/analytics/ConversionFunnel";
import { LandSegmentation } from "@/components/analytics/LandSegmentation";
import { DataQualityScore } from "@/components/analytics/DataQualityScore";
import { AiInsights } from "@/components/analytics/AiInsights";

export const dynamic = "force-dynamic";

const VALID_PERIODS = ["7d", "30d", "90d", "ytd"];
const EMPTY: AnalyticsData = {
  kpis: [], heatmap: { problems: [], crops: [], data: [] }, asrs: [], regions: [],
  funnel: [], land: [], quality: [], insights: [],
};

/** Analytics & Insights — all series computed live from farmer / sale / segment data. */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams?: { period?: string };
}) {
  const period = searchParams?.period && VALID_PERIODS.includes(searchParams.period) ? searchParams.period : "30d";
  let d: AnalyticsData;
  try {
    d = await getAnalytics(period);
  } catch {
    d = EMPTY;
  }

  return (
    <div className="animate-[fadeUp_0.4s_ease-out]">
      <PeriodFilter initial={period} />

      <HeroKpiBanner cells={d.kpis} />

      <div className="grid grid-cols-1 gap-[18px] mb-[18px] lg:grid-cols-[1.2fr_1fr]">
        <ProblemHeatmap heatmap={d.heatmap} />
        <AsrLeaderboard asrs={d.asrs} />
      </div>

      <div className="grid grid-cols-1 gap-[18px] mb-[18px] lg:grid-cols-2">
        <RegionalPerformance regions={d.regions} />
        <ConversionFunnel steps={d.funnel} />
      </div>

      <div className="grid grid-cols-1 gap-[18px] mb-[18px] lg:grid-cols-2">
        <LandSegmentation segments={d.land} />
        <DataQualityScore quality={d.quality} />
      </div>

      <AiInsights insights={d.insights} />
    </div>
  );
}
