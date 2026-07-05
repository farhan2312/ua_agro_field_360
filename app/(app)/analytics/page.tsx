import {
  FUNNEL,
  HEATMAP,
  ASRS,
  REGIONS,
  LAND_SEGMENTS,
  DATA_QUALITY,
  INSIGHTS,
} from "@/lib/demo-metrics";
import { PeriodFilter } from "@/components/analytics/PeriodFilter";
import { HeroKpiBanner } from "@/components/analytics/HeroKpiBanner";
import { ProblemHeatmap } from "@/components/analytics/ProblemHeatmap";
import { AsrLeaderboard } from "@/components/analytics/AsrLeaderboard";
import { RegionalPerformance } from "@/components/analytics/RegionalPerformance";
import { ConversionFunnel } from "@/components/analytics/ConversionFunnel";
import { LandSegmentation } from "@/components/analytics/LandSegmentation";
import { DataQualityScore } from "@/components/analytics/DataQualityScore";
import { AiInsights } from "@/components/analytics/AiInsights";

const VALID_PERIODS = ["7d", "30d", "90d", "ytd"];

/**
 * Analytics & Insights — read-only dashboard (spec 12). All series are
 * presentation metrics from lib/demo-metrics (not derivable from imported
 * master data), so this server component passes those constants straight to
 * the display sub-components. The period pills are visual-only client state.
 */
export default function AnalyticsPage({
  searchParams,
}: {
  searchParams?: { period?: string };
}) {
  const periodParam = searchParams?.period;
  const period = periodParam && VALID_PERIODS.includes(periodParam) ? periodParam : "30d";

  return (
    <div className="animate-[fadeUp_0.4s_ease-out]">
      <PeriodFilter initial={period} />

      <HeroKpiBanner />

      {/* Row 1: Heatmap + ASR Leaderboard */}
      <div className="grid grid-cols-1 gap-[18px] mb-[18px] lg:grid-cols-[1.2fr_1fr]">
        <ProblemHeatmap heatmap={HEATMAP} />
        <AsrLeaderboard asrs={ASRS} />
      </div>

      {/* Row 2: Regional Performance + Conversion Funnel */}
      <div className="grid grid-cols-1 gap-[18px] mb-[18px] lg:grid-cols-2">
        <RegionalPerformance regions={REGIONS} />
        <ConversionFunnel steps={FUNNEL} />
      </div>

      {/* Row 3: Land Segmentation + Data Quality */}
      <div className="grid grid-cols-1 gap-[18px] mb-[18px] lg:grid-cols-2">
        <LandSegmentation segments={LAND_SEGMENTS} />
        <DataQualityScore quality={DATA_QUALITY} />
      </div>

      {/* AI Insights */}
      <AiInsights insights={INSIGHTS} />
    </div>
  );
}
