import { redirect } from "next/navigation";
import { getRole, getPersona } from "@/lib/session";
import { getSession } from "@/lib/auth";
import { getHeaderCounts } from "@/lib/stats";
import { Sidebar } from "@/components/shell/Sidebar";
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
      <div className="ml-64 flex min-h-screen flex-1 flex-col">
        <Header role={role} counts={counts} />
        <main className="flex-1 px-8 py-7">{children}</main>
      </div>
    </div>
  );
}
