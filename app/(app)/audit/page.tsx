import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getRole } from "@/lib/session";
import { AuditTable, type AuditRowData } from "@/components/audit/AuditTable";

export const dynamic = "force-dynamic";

async function getAuditRows(): Promise<AuditRowData[]> {
  try {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return logs.map((l) => ({
      id: l.id,
      displayTs: l.displayTs ?? "",
      actor: l.actor ?? "",
      action: l.action,
      detail: l.detail ?? "",
      ip: l.ip ?? "",
    }));
  } catch {
    // DB not configured / seeded yet — render the empty table layout.
    return [];
  }
}

export default async function AuditPage() {
  // Sysadmin-only: enforce the gate at the route level, not just the nav link.
  if (getRole() !== "sysadmin") notFound();

  const rows = await getAuditRows();
  return <AuditTable rows={rows} />;
}
