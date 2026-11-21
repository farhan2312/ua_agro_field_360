// Server-only: every column that stores a user's EMPLOYEE CODE for attribution / ownership, plus the
// helpers that keep them in step when a code changes (temporary TE… code → permanent UA… code).
//
// Why it matters: `canSignOff` (mark an action done) and `canReviewVisit` (visit sign-off) match the
// signed-in user's CURRENT code against the code stamped on the record. If a code changes and the
// records keep the old one, the person can no longer complete their own follow-ups, and analytics that
// credit work by code (Overall usage, officer opt-in credit, campaign callers) split them in two.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** [table, code column, matching name column] — the name column helps suggest the owner of a lost code. */
export const EMPLOYEE_CODE_COLUMNS: [table: string, code: string, name: string | null][] = [
  ["Action", "createdByCode", "createdByName"], ["Action", "completedByCode", "completedByName"],
  ["ActionComment", "authorCode", "authorName"],
  ["Visit", "recordedByCode", "recordedBy"], ["Visit", "reviewedByCode", "reviewedByName"],
  ["VisitReviewRevision", "actorCode", "actorName"],
  ["CampaignMember", "reachedByCode", "reachedBy"], ["CampaignMemberRound", "reachedByCode", "reachedBy"],
  ["CampaignWorker", "assignedByCode", "assignedByName"], ["CampaignCaller", "assignedByCode", "assignedByName"],
  ["CampaignHelper", "assignedByCode", "assignedByName"], ["CampaignPhaseAdvance", "byCode", "byName"],
  ["Cluster", "createdByCode", "createdBy"], ["Broadcast", "createdByCode", "createdByName"],
  ["Ghoshti", "createdByCode", "createdByName"], ["Ghoshti", "approvedByCode", "approvedByName"],
  ["GhoshtiAttendee", "recordedByCode", "recordedByName"],
  ["Bug", "reporterCode", "reporter"],
  ["SmsLog", "sentByCode", "sentByName"], ["WhatsAppLog", "sentByCode", "sentByName"], ["WhatsAppMessage", "sentByCode", "sentByName"],
];

const q = (id: string) => Prisma.raw(`"${id}"`);

/** Statements that move every record stamped `oldCode` to `newCode` (run them inside one transaction). */
export function restampStatements(oldCode: string, newCode: string) {
  return EMPLOYEE_CODE_COLUMNS.map(([t, c]) => prisma.$executeRaw`UPDATE ${q(t)} SET ${q(c)} = ${newCode} WHERE ${q(c)} = ${oldCode}`);
}

export interface OrphanCode {
  code: string;
  rows: number;                             // records still stamped with it
  byTable: { table: string; column: string; rows: number }[];
  names: string[];                          // names recorded alongside it
  storeIds: number[];                       // stores of its visits / actions
  openActions: number;                      // follow-ups nobody can mark done as "maker"
  lastSeen: string | null;                  // latest visit / action with it (ISO)
}

/** Codes found on records that no user account has any more (deleted / re-created account, or a code
 *  changed outside the Users screen). */
export async function findOrphanCodes(): Promise<OrphanCode[]> {
  const out = new Map<string, OrphanCode>();
  for (const [t, c, nm] of EMPLOYEE_CODE_COLUMNS) {
    const rows = await prisma.$queryRaw<{ code: string; n: number; names: string[] | null }[]>`
      SELECT x.${q(c)} AS code, COUNT(*)::int AS n,
             ${nm ? Prisma.sql`array_agg(DISTINCT x.${q(nm)}) FILTER (WHERE x.${q(nm)} IS NOT NULL)` : Prisma.sql`NULL::text[]`} AS names
      FROM ${q(t)} x
      WHERE x.${q(c)} IS NOT NULL AND x.${q(c)} <> ''
        AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."employeeCode" = x.${q(c)})
      GROUP BY 1`;
    for (const r of rows) {
      const o = out.get(r.code) ?? out.set(r.code, { code: r.code, rows: 0, byTable: [], names: [], storeIds: [], openActions: 0, lastSeen: null }).get(r.code)!;
      o.rows += r.n;
      o.byTable.push({ table: t, column: c, rows: r.n });
      for (const x of r.names ?? []) if (x && !o.names.some((y) => y.toLowerCase() === x.trim().toLowerCase())) o.names.push(x.trim());
    }
  }
  const codes = [...out.keys()];
  if (codes.length) {
    const [vs, as, open] = await Promise.all([
      prisma.visit.groupBy({ by: ["recordedByCode", "storeId"], where: { recordedByCode: { in: codes } }, _max: { createdAt: true } }),
      prisma.action.groupBy({ by: ["createdByCode", "storeId"], where: { createdByCode: { in: codes } }, _max: { createdAt: true } }),
      prisma.action.groupBy({ by: ["createdByCode"], where: { createdByCode: { in: codes }, status: "OPEN" }, _count: { _all: true } }),
    ]);
    const bump = (code: string | null, storeId: number | null, at: Date | null) => {
      const o = code ? out.get(code) : undefined; if (!o) return;
      if (storeId != null && !o.storeIds.includes(storeId)) o.storeIds.push(storeId);
      if (at && (!o.lastSeen || at.toISOString() > o.lastSeen)) o.lastSeen = at.toISOString();
    };
    for (const v of vs) bump(v.recordedByCode, v.storeId, v._max.createdAt);
    for (const a of as) bump(a.createdByCode, a.storeId, a._max.createdAt);
    for (const a of open) { const o = a.createdByCode ? out.get(a.createdByCode) : undefined; if (o) o.openActions = a._count._all; }
  }
  return [...out.values()].sort((a, b) => b.openActions - a.openActions || b.rows - a.rows);
}
