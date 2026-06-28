import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ProjectHeaderCard } from "@/components/project-detail/ProjectHeaderCard";
import { AssignedFarmersCard } from "@/components/project-detail/AssignedFarmersCard";
import { ActivityLogCard, type ProjectUpdateItem } from "@/components/project-detail/ActivityLogCard";
import type { ProjectStatus } from "@prisma/client";

interface LoadedProject {
  id: number;
  title: string;
  status: ProjectStatus | null;
  owner: string;
  due: string;
  group: string;
  farmerNames: string[];
  updates: ProjectUpdateItem[];
}

async function loadProject(id: number): Promise<LoadedProject | null> {
  try {
    const p = await prisma.project.findUnique({
      where: { id },
      include: { updates: { orderBy: { createdAt: "desc" } } },
    });
    if (!p) return null;
    return {
      id: p.id,
      title: p.title,
      status: p.status,
      owner: p.owner ?? "",
      due: p.due ?? "",
      group: p.groupName ?? "",
      farmerNames: p.farmerNames ?? [],
      updates: p.updates.map((u) => ({
        id: u.id,
        text: u.text,
        by: u.by ?? "",
        date: u.date ?? "",
      })),
    };
  } catch {
    // DB unavailable pre-seed — treat as not found (render nothing crashes).
    return null;
  }
}

export default async function ProjectDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const id = Number(params.id);
  const project = Number.isNaN(id) ? null : await loadProject(id);
  if (!project) notFound();

  return (
    <div className="animate-[fadeUp_0.4s_ease-out]">
      <Link
        href="/actions"
        className="mb-5 inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-[#757575] hover:text-[#2E7D32]"
      >
        ← Back to Action Planner
      </Link>

      <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-[1fr_1.4fr]">
        {/* Left column */}
        <div className="flex flex-col gap-4">
          <ProjectHeaderCard
            project={{
              id: project.id,
              title: project.title,
              status: project.status,
              owner: project.owner,
              due: project.due,
              group: project.group,
            }}
          />
          <AssignedFarmersCard farmers={project.farmerNames} />
        </div>

        {/* Right column */}
        <ActivityLogCard projectId={project.id} updates={project.updates} />
      </div>
    </div>
  );
}
