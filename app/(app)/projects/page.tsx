import { notFound } from "next/navigation";
import { getRole } from "@/lib/session";
import { canAccess } from "@/lib/roles";
import { listProjects, listClustersWithCounts, type ProjectVM, type ClusterVM } from "@/app/actions/campaigns";
import { ProjectsTab } from "@/components/campaigns/ProjectsTab";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const role = await getRole();
  if (!canAccess("projects", role)) notFound();

  let projects: ProjectVM[] = [];
  let clusters: ClusterVM[] = [];
  try {
    [projects, clusters] = await Promise.all([listProjects(), listClustersWithCounts()]);
  } catch {
    // DB unavailable — render an empty shell.
  }

  return (
    <div className="animate-[fadeUp_0.4s_ease-out]">
      <ProjectsTab initial={projects} clusters={clusters} />
    </div>
  );
}
