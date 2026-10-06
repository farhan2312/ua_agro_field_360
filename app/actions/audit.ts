"use server";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getRole } from "@/lib/session";
import type { AuditRowData } from "@/components/audit/AuditTable";

export interface AuditFilters {
  from?: string;        // IST calendar day (YYYY-MM-DD)
  to?: string;          // IST calendar day (YYYY-MM-DD)
  actions?: string[];   // CREATE | UPDATE | CONFIG | EXPORT | DELETE
  q?: string;           // free text over actor / detail / entity
  cursor?: number | null; // keyset: fetch rows with id < cursor (older)
  limit?: number;
}
export interface AuditPage { rows: AuditRowData[]; nextCursor: number | null }

const ymd = (s: string | undefined, endOfDay = false): Date | null =>
  s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+05:30`) : null;

const fmtTs = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });

/** Filtered, keyset-paginated audit log (sysadmin only). Newest first; pass the last row's cursor for more. */
export async function getAuditLog(f: AuditFilters = {}): Promise<AuditPage> {
  if ((await getRole()) !== "sysadmin") return { rows: [], nextCursor: null };
  const where: Prisma.AuditLogWhereInput = {};
  if (f.actions?.length) where.action = { in: f.actions };
  const from = ymd(f.from), to = ymd(f.to, true);
  if (from || to) where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  const q = (f.q ?? "").trim();
  if (q) where.OR = [
    { actor: { contains: q, mode: "insensitive" } },
    { detail: { contains: q, mode: "insensitive" } },
    { entity: { contains: q, mode: "insensitive" } },
  ];
  if (f.cursor) where.id = { lt: f.cursor };

  const limit = Math.min(Math.max(f.limit ?? 100, 1), 500);
  try {
    const logs = await prisma.auditLog.findMany({ where, orderBy: { id: "desc" }, take: limit + 1 });
    const hasMore = logs.length > limit;
    const page = hasMore ? logs.slice(0, limit) : logs;
    const rows: AuditRowData[] = page.map((l) => ({
      id: l.id,
      displayTs: l.displayTs || fmtTs(l.createdAt),
      actor: l.actor ?? "",
      action: l.action,
      detail: l.detail ?? "",
      ip: l.ip ?? "",
    }));
    return { rows, nextCursor: hasMore ? page[page.length - 1].id : null };
  } catch {
    return { rows: [], nextCursor: null };
  }
}
