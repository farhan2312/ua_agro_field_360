import { redirect } from "next/navigation";
import { getRole, getPersona } from "@/lib/session";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Sidebar } from "@/components/shell/Sidebar";
import { Header, type HeaderCounts } from "@/components/shell/Header";
import type { RoleKey } from "@/lib/roles";

export const dynamic = "force-dynamic";

async function getCounts(): Promise<HeaderCounts> {
  try {
    const [farmers, activeUsers, projects, activeProjects] = await Promise.all([
      prisma.farmer.count(),
      prisma.user.count({ where: { active: true, approvalStatus: "APPROVED" } }),
      prisma.project.count(),
      prisma.project.count({ where: { status: "ACTIVE" } }),
    ]);
    return { farmers, activeUsers, projects, activeProjects };
  } catch {
    return { farmers: 1284, activeUsers: 5, projects: 5, activeProjects: 2 };
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login"); // belt-and-suspenders (middleware also guards)

  const [role, persona, counts] = await Promise.all([
    getRole(),
    getPersona(),
    getCounts(),
  ]);

  const isAdmin = session.isAdmin;
  const impersonating: RoleKey | null =
    isAdmin && role !== session.roleKey ? role : null;

  return (
    <div className="flex min-h-screen bg-canvas">
      <Sidebar
        role={role}
        persona={persona}
        isAdmin={isAdmin}
        impersonating={impersonating}
      />
      <div className="ml-64 flex min-h-screen flex-1 flex-col">
        <Header role={role} counts={counts} />
        <main className="flex-1 px-8 py-7">{children}</main>
      </div>
    </div>
  );
}
