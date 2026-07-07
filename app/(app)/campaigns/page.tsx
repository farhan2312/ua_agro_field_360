import { notFound } from "next/navigation";
import { getRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getSegmentMatrix, listCampaigns, type SegmentMatrix, type CampaignListItem } from "@/app/actions/campaigns";
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
  try {
    if ((await prisma.commTemplate.count()) === 0) {
      await prisma.commTemplate.createMany({ data: DEFAULT_COMM_TEMPLATES, skipDuplicates: true });
    }
    const [tpls, m, camps, sts] = await Promise.all([
      prisma.commTemplate.findMany({ orderBy: { priority: "asc" } }),
      getSegmentMatrix("all"),
      listCampaigns(),
      prisma.store.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ]);
    templates = tpls.map((t) => ({
      segment: t.segment, priority: t.priority, medium: t.medium,
      offer: t.offer, timingLabel: t.timingLabel, template: t.template,
    }));
    matrix = m;
    campaigns = camps;
    stores = sts;
  } catch {
    // DB unavailable — render an empty shell.
  }

  return (
    <CampaignsScreen
      initialMatrix={matrix}
      templates={templates}
      campaigns={campaigns}
      stores={stores}
    />
  );
}
