import { notFound } from "next/navigation";
import { getRole } from "@/lib/session";
import { canAccess } from "@/lib/roles";
import { canManage } from "@/lib/scope";
import { prisma } from "@/lib/prisma";
import { listCampaigns, listProjects, type CampaignListItem, type ProjectVM } from "@/app/actions/campaigns";
import { DEFAULT_COMM_TEMPLATES } from "@/lib/campaign-segments";
import { CampaignsScreen, type CommTemplateVM, type StoreLite } from "@/components/campaigns/CampaignsScreen";

export const dynamic = "force-dynamic";

export default async function CampaignsPage({ searchParams }: { searchParams?: { forProject?: string } }) {
  const role = await getRole();
  if (!canAccess("campaigns", role)) notFound();
  const manage = canManage(role);

  // Chain: /campaigns?forProject=<id> opens the create form with that project preselected.
  const forProject = Number(searchParams?.forProject);
  const initialProjectId = manage && Number.isInteger(forProject) && forProject > 0 ? forProject : undefined;

  let templates: CommTemplateVM[] = [];
  let campaigns: CampaignListItem[] = [];
  let stores: StoreLite[] = [];
  let projects: ProjectVM[] = [];
  try {
    if ((await prisma.commTemplate.count()) === 0) {
      await prisma.commTemplate.createMany({ data: DEFAULT_COMM_TEMPLATES, skipDuplicates: true });
    }
    const [tpls, camps, sts, projs] = await Promise.all([
      prisma.commTemplate.findMany({ orderBy: [{ priority: "asc" }, { name: "asc" }] }),
      listCampaigns(),
      prisma.store.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      manage ? listProjects() : Promise.resolve<ProjectVM[]>([]), // project catalog is central-only; don't leak it to officers/RMs
    ]);
    templates = tpls.map((t) => ({
      id: t.id, name: t.name, language: t.language, promoType: t.promoType,
      segment: t.segment, priority: t.priority, medium: t.medium,
      offer: t.offer, timingLabel: t.timingLabel, template: t.template,
    }));
    campaigns = camps;
    stores = sts;
    projects = projs;
  } catch {
    // DB unavailable — render an empty shell.
  }

  return (
    <CampaignsScreen
      templates={templates}
      campaigns={campaigns}
      stores={stores}
      projects={projects}
      canManage={manage}
      initialProjectId={initialProjectId}
    />
  );
}
