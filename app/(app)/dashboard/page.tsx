import { prisma } from "@/lib/prisma";
import { getRole, getPersona } from "@/lib/session";
import { DEFAULT_KPI } from "@/lib/demo-metrics";
import { initials, avatarColor } from "@/lib/format";
import { statusColor } from "@/lib/status";
import { AUDIT_ACTION_META } from "@/lib/status";
import type { KpiData } from "@/app/actions/dashboard";
import {
  AnalyticsOverview,
  type RecentVisitVM,
} from "@/components/dashboard/AnalyticsOverview";
import { OfficerBanner } from "@/components/dashboard/OfficerBanner";
import { CentralBanner } from "@/components/dashboard/CentralBanner";
import {
  SysadminPanel,
  type SystemEventVM,
} from "@/components/dashboard/SysadminPanel";

/** Fallback system events (from the original template) when no AuditLog rows exist. */
const FALLBACK_EVENTS: SystemEventVM[] = [
  { text: "Database backup completed", meta: "Today, 06:00 AM · Automated", dot: "#2E7D32" },
  { text: "GPS setting changed to mandatory", meta: "Yesterday, 6:45 PM · Vikash Mehta", dot: "#F57F17" },
  { text: "User removed: Ravi Sharma (Hathras)", meta: "Yesterday, 11:00 AM · Vikash Mehta", dot: "#C62828" },
  { text: "Crop master updated: added 3 new varieties", meta: "Jun 20, 3:15 PM · Vikash Mehta", dot: "#1565C0" },
];

async function loadKpi(): Promise<KpiData> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: "kpi.data" } });
    if (row?.value) {
      const parsed = JSON.parse(row.value) as Partial<KpiData>;
      return { ...DEFAULT_KPI, ...parsed };
    }
  } catch {
    // DB unavailable pre-seed — fall back to defaults.
  }
  return { ...DEFAULT_KPI };
}

async function loadRecentVisits(officerName?: string): Promise<RecentVisitVM[]> {
  try {
    const visits = await prisma.visit.findMany({
      where: officerName ? { officerName } : undefined,
      orderBy: [{ visitedAt: "desc" }, { createdAt: "desc" }],
      take: 5,
      include: {
        farmer: {
          select: { name: true, village: true, crop: true, status: true },
        },
      },
    });

    return visits.map((v, i): RecentVisitVM => {
      const farmerName = v.farmer?.name ?? "Unknown farmer";
      const status = v.farmer?.status ?? v.purpose ?? "—";
      const sc = statusColor(v.farmer?.status ?? v.purpose ?? null);
      return {
        id: v.id,
        farmer: farmerName,
        village: v.farmer?.village ?? "—",
        crop: v.farmer?.crop ?? "—",
        officer: v.officerName ?? "—",
        date: v.date ?? "—",
        init: initials(farmerName),
        avatarBg: avatarColor(i),
        status,
        sBg: sc.bg,
        sColor: sc.c,
      };
    });
  } catch {
    return [];
  }
}

async function loadSystemEvents(): Promise<SystemEventVM[]> {
  try {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 4,
    });
    if (logs.length === 0) return FALLBACK_EVENTS;
    return logs.map((l): SystemEventVM => ({
      text: l.detail ?? l.action,
      meta: `${l.displayTs ?? ""}${l.actor ? ` · ${l.actor}` : ""}`.replace(/^ · /, ""),
      dot: AUDIT_ACTION_META[l.action]?.c ?? "#9E9E9E",
    }));
  } catch {
    return FALLBACK_EVENTS;
  }
}

export default async function DashboardPage() {
  const role = await getRole();
  const persona = await getPersona();

  const kpi = await loadKpi();
  const recent = await loadRecentVisits(
    role === "officer" ? persona.name : undefined,
  );
  const events = role === "sysadmin" ? await loadSystemEvents() : [];

  return (
    <div className="animate-fadeUp">
      {role === "officer" && <OfficerBanner />}
      {role === "central" && <CentralBanner />}
      {role === "sysadmin" && <SysadminPanel kpi={kpi} events={events} />}

      {/* Shared analytics block — always shown for every role (showAnalytics === true) */}
      <div className={role === "sysadmin" ? "mt-5" : ""}>
        <AnalyticsOverview kpi={kpi} recent={recent} cropTotal="847" />
      </div>
    </div>
  );
}
