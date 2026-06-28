import { getRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Sidebar } from "@/components/shell/Sidebar";
import { Header, type HeaderCounts } from "@/components/shell/Header";

export const dynamic = "force-dynamic";

async function getCounts(): Promise<HeaderCounts> {
  try {
    const [farmers, activeUsers, projects, activeProjects] = await Promise.all([
      prisma.farmer.count(),
      prisma.user.count({ where: { active: true } }),
      prisma.project.count(),
      prisma.project.count({ where: { status: "ACTIVE" } }),
    ]);
    return { farmers, activeUsers, projects, activeProjects };
  } catch {
    // DB not configured/seeded yet — fall back to design demo numbers
    return { farmers: 1284, activeUsers: 5, projects: 5, activeProjects: 2 };
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const role = getRole();
  const counts = await getCounts();

  return (
    <div className="flex min-h-screen bg-canvas">
      <Sidebar role={role} />
      <div className="ml-64 flex min-h-screen flex-1 flex-col">
        <Header role={role} counts={counts} />
        <main className="flex-1 px-8 py-7">{children}</main>
      </div>
    </div>
  );
}
