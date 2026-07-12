import { notFound } from "next/navigation";
import { getRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  getSegmentMatrix, listCampaigns, listClustersWithCounts, listProjects,
  type SegmentMatrix, type CampaignListItem, type ClusterVM, type ProjectVM,
} from "@/app/actions/campaigns";
import { DEFAULT_COMM_TEMPLATES } from "@/lib/campaign-segments";
import { CampaignsScreen, type CommTemplateVM, type StoreLite } from "@/components/campaigns/CampaignsScreen";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const role = await getRole();
  if (!(role === "regional" || role === "central" || role === "sysadmin")) notFound();

  let templates: CommTemplateVM[] = [];
  let matrix: SegmentMatrix = { rows: [], totals: {}, grandTotal: 0 };
  let campaigns: CampaignListItem[] = [];
  let stores: StoreLite[] = [];
  let clusters: ClusterVM[] = [];
  let projects: ProjectVM[] = [];
  let zones: string[] = [];
  try {
    if ((await prisma.commTemplate.count()) === 0) {
      await prisma.commTemplate.createMany({ data: DEFAULT_COMM_TEMPLATES, skipDuplicates: true });
    }
    const [tpls, m, camps, sts, cls, projs, zoneRows] = await Promise.all([
      prisma.commTemplate.findMany({ orderBy: { priority: "asc" } }),
      getSegmentMatrix("all"),
      listCampaigns(),
      prisma.store.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      listClustersWithCounts(),
      listProjects(),
      prisma.farmer.findMany({ where: { zone: { not: null }, source: "REAL" }, distinct: ["zone"], select: { zone: true }, orderBy: { zone: "asc" } }),
    ]);
    templates = tpls.map((t) => ({
      segment: t.segment, priority: t.priority, medium: t.medium,
      offer: t.offer, timingLabel: t.timingLabel, template: t.template,
    }));
    matrix = m;
    campaigns = camps;
    stores = sts;
    clusters = cls;
    projects = projs;
    zones = zoneRows.map((z) => z.zone!).filter(Boolean);
  } catch {
    // DB unavailable — render an empty shell.
  }

  return (
    <CampaignsScreen
      initialMatrix={matrix}
      templates={templates}
      campaigns={campaigns}
      stores={stores}
      clusters={clusters}
      projects={projects}
      zones={zones}
    />
  );
}
