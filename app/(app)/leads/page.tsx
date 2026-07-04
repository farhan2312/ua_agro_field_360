import { prisma } from "@/lib/prisma";
import { LeadsBoard } from "@/components/leads/LeadsBoard";
import type { LeadCardData, LeadColumnData } from "@/components/leads/types";

/**
 * Lead Pipeline (server component).
 *
 * Read-only kanban board grouping farmers into 4 columns by their lead status.
 * We key off the clean `Farmer.leadStatus` enum (NOT the overloaded legacy `status`
 * string) so High-Value / Dormant farmers are not silently dropped — see spec
 * 22-leads-pipeline §6 port notes #2.
 *
 * KNOWN GAP: `LeadStatus` also has a `DORMANT` member which has no board column
 * (the board only renders New / Contacted / Follow-up / Converted). Dormant leads
 * therefore do not appear here by design, matching the original 4-column layout.
 */

// Column definitions: prisma enum value → display title + status-dot color.
const COLUMNS = [
  { key: "NEW", title: "New", color: "#2E7D32" },
  { key: "CONTACTED", title: "Contacted", color: "#1565C0" },
  { key: "FOLLOWUP", title: "Follow-up", color: "#E65100" },
  { key: "CONVERTED", title: "Converted", color: "#7B1FA2" },
] as const;

type LeadFarmer = {
  id: number;
  name: string;
  village: string | null;
  crop: string | null;
  land: number | null;
  leadStatus: string | null;
  visits: { date: string | null; visitedAt: Date | null }[];
};

function lastVisitLabel(visits: LeadFarmer["visits"]): string | null {
  if (visits.length === 0) return null;
  // Prefer the most recent by real timestamp; fall back to the display string.
  const withTs = visits.filter((v) => v.visitedAt);
  if (withTs.length > 0) {
    const latest = withTs.reduce((a, b) =>
      (b.visitedAt as Date) > (a.visitedAt as Date) ? b : a,
    );
    return latest.date ?? null;
  }
  return visits[0].date ?? null;
}

export default async function LeadsPage() {
  let farmers: LeadFarmer[] = [];
  try {
    farmers = await prisma.farmer.findMany({
      where: { leadStatus: { not: null } },
      select: {
        id: true,
        name: true,
        village: true,
        crop: true,
        land: true,
        leadStatus: true,
        // Only the most recent visit is needed for the card's "last visit"
        // label — bound this so it never loads a farmer's full visit history.
        visits: {
          select: { date: true, visitedAt: true },
          orderBy: { visitedAt: { sort: "desc", nulls: "last" } },
          take: 1,
        },
      },
      orderBy: { name: "asc" },
    });
  } catch {
    // DB unavailable (pre-seed) — render the board with empty columns.
    farmers = [];
  }

  const columns: LeadColumnData[] = COLUMNS.map((col) => {
    const items: LeadCardData[] = farmers
      .filter((f) => f.leadStatus === col.key)
      .map((f) => ({
        id: f.id,
        name: f.name,
        village: f.village,
        crop: f.crop,
        land: f.land,
        lastVisit: lastVisitLabel(f.visits),
      }));
    return { key: col.key, title: col.title, color: col.color, count: items.length, items };
  });

  return <LeadsBoard columns={columns} />;
}
