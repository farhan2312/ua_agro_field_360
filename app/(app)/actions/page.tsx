import { prisma } from "@/lib/prisma";
import { ActionPlannerBoard, type ProjectDTO, type ClusterOption } from "@/components/actions/ActionPlannerBoard";

/** Map the Prisma ProjectStatus enum to the lane keys used by the board. */
const STATUS_TO_LANE: Record<string, ProjectDTO["status"]> = {
  ACTIVE: "active",
  PLANNED: "planned",
  COMPLETED: "completed",
};

export default async function ActionsPage() {
  let projects: ProjectDTO[] = [];
  let clusterOptions: ClusterOption[] = [];

  try {
    const [rows, clusters] = await Promise.all([
      prisma.project.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          status: true,
          owner: true,
          due: true,
          groupName: true,
          farmerNames: true,
          _count: { select: { updates: true } },
        },
      }),
      prisma.cluster.findMany({
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, farmerIds: true },
      }),
    ]);

    projects = rows.map((p) => ({
      id: p.id,
      title: p.title,
      group: p.groupName ?? "",
      owner: p.owner ?? "—",
      due: p.due ?? "—",
      status: STATUS_TO_LANE[p.status] ?? "planned",
      farmerCount: p.farmerNames.length,
      updateCount: p._count.updates,
    }));

    clusterOptions = clusters.map((c) => ({
      value: c.name,
      label: `${c.name} (${c.farmerIds.length} farmers)`,
    }));
  } catch {
    // DB unavailable pre-seed — render the real layout with empty lanes.
    projects = [];
    clusterOptions = [];
  }

  return <ActionPlannerBoard projects={projects} clusterOptions={clusterOptions} />;
}
