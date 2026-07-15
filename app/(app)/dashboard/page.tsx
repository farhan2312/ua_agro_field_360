import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getPersona } from "@/lib/session";
import { getScope, type Scope } from "@/lib/scope";
import { DEFAULT_KPI } from "@/lib/demo-metrics";
import { initials, avatarColor } from "@/lib/format";
import { statusColor } from "@/lib/status";
import { AUDIT_ACTION_META } from "@/lib/status";
import { segMeta } from "@/lib/campaign-segments";
import type { KpiData } from "@/app/actions/dashboard";
import {
  AnalyticsOverview,
  type RecentVisitVM,
} from "@/components/dashboard/AnalyticsOverview";
import { CentralBanner } from "@/components/dashboard/CentralBanner";
import {
  SysadminPanel,
  type SystemEventVM,
} from "@/components/dashboard/SysadminPanel";
import {
  ScopedDashboard,
  UnassignedDashboard,
  type ScopedDashboardData,
  type ScopedSegBar,
  type ScopedRecentVisit,
} from "@/components/dashboard/ScopedDashboard";

/** Officer/RM dashboard data — scoped to the viewer's own store (officer) or region (RM). Null = no store/region assigned. */
async function loadScopedDashboard(scope: Scope): Promise<ScopedDashboardData | null> {
  const isStore = scope.role === "officer";
  const { storeId, zone } = scope;
  if (isStore && storeId == null) return null;
  if (!isStore && zone == null) return null;

  const farmerWhere: Prisma.FarmerWhereInput = isStore
    ? { source: "REAL", storeId: storeId! }
    : { source: "REAL", zone: zone! };
  const visitWhere: Prisma.VisitWhereInput = isStore
    ? { storeId: storeId! }
    : { farmer: { zone: zone! } };

  try {
    const [store, farmers, segRows, agg, visits, recentRows, storeCount] = await Promise.all([
      isStore ? prisma.store.findUnique({ where: { id: storeId! }, select: { name: true, zone: true } }) : Promise.resolve(null),
      prisma.farmer.count({ where: farmerWhere }),
      prisma.farmer.groupBy({ by: ["campaignSegment"], where: farmerWhere, _count: { _all: true } }),
      prisma.farmer.aggregate({ where: farmerWhere, _sum: { p12mSpend: true } }),
      prisma.visit.count({ where: visitWhere }),
      prisma.visit.findMany({
        where: visitWhere,
        orderBy: [{ visitedAt: "desc" }, { createdAt: "desc" }],
        take: 5,
        include: { farmer: { select: { name: true, village: true, status: true } } },
      }),
      isStore ? Promise.resolve(0) : prisma.store.count({ where: { source: "REAL", zone: zone! } }),
    ]);

    const countBy = new Map<string, number>();
    for (const r of segRows) if (r.campaignSegment) countBy.set(r.campaignSegment, r._count._all);
    const ORDER = ["HNI", "POTENTIAL_HNI", "REGULAR", "AT_RISK", "NEW", "LAPSED"];
    const segments: ScopedSegBar[] = ORDER.filter((k) => countBy.get(k)).map((k) => {
      const m = segMeta(k);
      return { key: k, label: m.label, count: countBy.get(k) ?? 0, color: m.color, bg: m.bg };
    });
    const recent: ScopedRecentVisit[] = recentRows.map((v) => ({
      id: v.id,
      farmer: v.farmer?.name ?? "Unknown farmer",
      village: v.farmer?.village ?? "—",
      officer: v.officerName ?? "—",
      date: v.date ?? "—",
      status: v.farmer?.status ?? v.purpose ?? "—",
    }));

    return {
      kind: isStore ? "store" : "zone",
      label: isStore ? store?.name ?? `Store #${storeId}` : zone!,
      sub: isStore ? store?.zone ?? "" : `${storeCount} store${storeCount === 1 ? "" : "s"} in region`,
      kpi: {
        farmers,
        hni: countBy.get("HNI") ?? 0,
        potentialHni: countBy.get("POTENTIAL_HNI") ?? 0,
        revenue12m: agg._sum.p12mSpend ?? 0,
        visits,
      },
      segments,
      recent,
    };
  } catch {
    return null;
  }
}

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
  const [scope, persona] = await Promise.all([getScope(), getPersona()]);
  const role = scope.role;

  // Officers & RMs get a fully scoped dashboard — only their store / region, nothing global.
  if (role === "officer" || role === "regional") {
    const data = await loadScopedDashboard(scope);
    return (
      <div className="animate-fadeUp">
        {data
          ? <ScopedDashboard data={data} name={persona.name} />
          : <UnassignedDashboard name={persona.name} kind={role === "officer" ? "store" : "region"} />}
      </div>
    );
  }

  // Central / sysadmin — unchanged organization-wide view.
  const kpi = await loadKpi();
  const recent = await loadRecentVisits();
  const events = role === "sysadmin" ? await loadSystemEvents() : [];

  return (
    <div className="animate-fadeUp">
      {role === "central" && <CentralBanner />}
      {role === "sysadmin" && <SysadminPanel kpi={kpi} events={events} />}

      {/* Shared analytics block — organization-wide (central/sysadmin only) */}
      <div className={role === "sysadmin" ? "mt-5" : ""}>
        <AnalyticsOverview kpi={kpi} recent={recent} cropTotal="847" />
      </div>
    </div>
  );
}
