"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { routeToView } from "@/lib/nav";
import { viewTitle, type RoleKey } from "@/lib/roles";
import { grouped } from "@/lib/format";
import { canAccess } from "@/lib/roles";
import { SyncBadge } from "../ui";
import { PlusIcon, ShieldIcon } from "../icons";

export interface HeaderCounts {
  farmers: number;
  activeUsers: number;
  projects: number;
  activeProjects: number;
}

export function Header({ role, counts }: { role: RoleKey; counts: HeaderCounts }) {
  const pathname = usePathname();
  const view = routeToView(pathname);
  let [title, subtitle] = viewTitle(view, role, {
    projectCount: counts.projects,
    activeCount: counts.activeProjects,
  });

  // Subtitles that depend on live counts
  if (view === "farmers")
    subtitle = `${grouped(counts.farmers)} registered farmers · Segmented view`;
  if (view === "users")
    subtitle = `${counts.activeUsers} active users · Role-based access`;
  if (view === "newVisit") subtitle = "Field visit entry · 5 steps";

  const showNewVisit = canAccess("newVisit", role);
  const isAdmin = role === "sysadmin";

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-line-warm bg-white px-8">
      <div>
        <div className="text-xl font-bold text-ink">{title}</div>
        {subtitle && <div className="mt-px text-[11.5px] text-ink-muted">{subtitle}</div>}
      </div>

      <div className="flex items-center gap-3">
        <SyncBadge />

        {isAdmin && (
          <span className="inline-flex items-center gap-1.5 rounded-[20px] border border-gold-200 bg-orange-50 px-3.5 py-1.5 text-[11px] font-semibold text-orange">
            <ShieldIcon className="text-orange" />
            Admin Mode
          </span>
        )}

        {showNewVisit && (
          <Link
            href="/visits/new"
            className="inline-flex items-center gap-1.5 rounded-[10px] bg-brand-600 px-5 py-[9px] text-[13px] font-semibold tracking-[0.2px] text-white transition-colors hover:bg-brand-700 active:scale-[0.97]"
          >
            <PlusIcon />
            New Visit
          </Link>
        )}
      </div>
    </header>
  );
}
