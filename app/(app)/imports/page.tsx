import { notFound } from "next/navigation";
import { getRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { SalesImportScreen, type ImportRow } from "@/components/imports/SalesImportScreen";
import { listErpSyncRuns, type ErpRunVM } from "@/app/actions/erp-sync";

export const dynamic = "force-dynamic";

const DAY = 86_400_000, IST = 330 * 60_000;
const yesterdayIST = () => new Date(Date.now() + IST - DAY).toISOString().slice(0, 10);

export default async function SalesImportPage() {
  // Sysadmin-only — enforce at the route, not just the nav link.
  if ((await getRole()) !== "sysadmin") notFound();

  let history: ImportRow[] = [];
  try {
    const rows = await prisma.salesImport.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
    history = rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      fileType: r.fileType ?? "",
      uploadedBy: r.uploadedBy ?? "",
      status: r.status,
      lineItems: r.lineItems,
      bills: r.bills,
      newCustomers: r.newCustomers,
      salesInserted: r.salesInserted,
      skipped: r.skipped,
      rangeStart: r.rangeStart,
      rangeEnd: r.rangeEnd,
      error: r.error,
      // Force IST (server runs in UTC), so the shown time matches when the admin actually uploaded.
      when: r.createdAt.toLocaleString("en-GB", {
        day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
        timeZone: "Asia/Kolkata",
      }),
    }));
  } catch {
    // DB not reachable yet — render the empty layout.
  }

  let erpRuns: ErpRunVM[] = [];
  try { erpRuns = await listErpSyncRuns(15); } catch { /* table may not exist pre-migrate */ }

  return <SalesImportScreen history={history} erpRuns={erpRuns} erpDefaultDate={yesterdayIST()} />;
}
