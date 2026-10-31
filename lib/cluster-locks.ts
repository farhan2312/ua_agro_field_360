import { prisma } from "@/lib/prisma";

/**
 * Clusters that are "frozen" because they feed a LIVE campaign — one whose status is not CLOSED.
 * A campaign reaches a cluster either directly (Campaign.clusterId) or through the project it runs
 * (Campaign.projectId → Project.clusters, the many-to-many bundle).
 *
 * A frozen cluster's rule (and the cluster itself) must not be edited or deleted: it would retarget
 * or pull the ground out from under a campaign that is already running on that audience. Once the
 * campaign is closed, the lock lifts automatically.
 *
 * Returns clusterId → the name of ONE locking campaign (used for the UI message). Pass `clusterIds`
 * to only compute the clusters you care about; omit to get every locked cluster.
 */
export async function clusterCampaignLocks(clusterIds?: number[]): Promise<Map<number, string>> {
  const camps = await prisma.campaign.findMany({
    where: { status: { not: "CLOSED" } },
    select: { name: true, clusterId: true, projectId: true },
  });

  // Resolve the clusters bundled into any project a live campaign runs.
  const projectIds = [...new Set(camps.map((c) => c.projectId).filter((x): x is number => x != null))];
  const projs = projectIds.length
    ? await prisma.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, clusters: { select: { id: true } } },
      })
    : [];
  const clustersByProject = new Map(projs.map((p) => [p.id, p.clusters.map((c) => c.id)]));

  const want = clusterIds ? new Set(clusterIds) : null;
  const locks = new Map<number, string>();
  const add = (cid: number, name: string) => {
    if ((!want || want.has(cid)) && !locks.has(cid)) locks.set(cid, name);
  };
  for (const c of camps) {
    if (c.clusterId != null) add(c.clusterId, c.name);
    if (c.projectId != null) for (const cid of clustersByProject.get(c.projectId) ?? []) add(cid, c.name);
  }
  return locks;
}

/** The name of a live campaign locking this one cluster, or null when it's free to edit/delete. */
export async function clusterCampaignLock(clusterId: number): Promise<string | null> {
  const locks = await clusterCampaignLocks([clusterId]);
  return locks.get(clusterId) ?? null;
}
