import { redirect } from "next/navigation";
import { getRole, getPersona } from "@/lib/session";
import { getSession } from "@/lib/auth";
import { getHeaderCounts } from "@/lib/stats";
import { Sidebar } from "@/components/shell/Sidebar";
import { MobileNav } from "@/components/shell/MobileNav";
import { Header } from "@/components/shell/Header";
import type { RoleKey } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login"); // belt-and-suspenders (middleware also guards)

  const [role, persona, counts] = await Promise.all([
    getRole(),
    getPersona(),
    getHeaderCounts(),
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
      <div className="flex min-h-screen flex-1 flex-col lg:ml-64">
        <Header role={role} counts={counts} />
        <main className="flex-1 px-4 py-5 pb-24 lg:px-8 lg:py-7 lg:pb-7">{children}</main>
      </div>
      <MobileNav
        role={role}
        persona={persona}
        isAdmin={isAdmin}
        impersonating={impersonating}
      />
    </div>
  );
}
