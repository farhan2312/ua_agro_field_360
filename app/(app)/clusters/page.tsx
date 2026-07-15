import { notFound } from "next/navigation";
import { getRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { canAccess } from "@/lib/roles";
import { listClustersWithCounts, getCropOptions, type ClusterVM } from "@/app/actions/campaigns";
import { ClustersTab } from "@/components/campaigns/ClustersTab";
import type { CropOption } from "@/components/campaigns/CampaignsScreen";

export const dynamic = "force-dynamic";

export default async function SegmentationPage() {
  const role = await getRole();
  if (!canAccess("farmerCluster", role)) notFound();

  let clusters: ClusterVM[] = [];
  let zones: string[] = [];
  let crops: CropOption[] = [];
  try {
    const [cls, zoneRows, cropOpts] = await Promise.all([
      listClustersWithCounts(),
      prisma.farmer.findMany({ where: { zone: { not: null }, source: "REAL" }, distinct: ["zone"], select: { zone: true }, orderBy: { zone: "asc" } }),
      getCropOptions(),
    ]);
    clusters = cls;
    zones = zoneRows.map((z) => z.zone!).filter(Boolean);
    crops = cropOpts;
  } catch {
    // DB unavailable — render an empty shell.
  }

  return (
    <div className="animate-[fadeUp_0.4s_ease-out]">
      <ClustersTab initial={clusters} zones={zones} crops={crops} />
    </div>
  );
}
