import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getRole } from "@/lib/session";
import { getScope } from "@/lib/scope";
import { getOptInQrConfig } from "@/app/actions/whatsapp-optins";
import { NewVisitWizard } from "@/components/new-visit/NewVisitWizard";
import {
  resolveOptions,
  DISTRICTS,
  VILLAGES,
  VISIT_REASONS,
  type WizardOptions,
} from "@/components/new-visit/field-options";

export const dynamic = "force-dynamic";

export default async function NewVisitPage() {
  // Route guard: the `central` persona has no New Visit nav entry (spec §1).
  const role = await getRole();
  if (role === "central") redirect("/analytics");

  let options: WizardOptions = resolveOptions([]);
  // Geo master: distinct districts/villages actually present in the farmer book,
  // so the dropdowns reflect real operating areas (fall back to the spec lists).
  let districts: string[] = DISTRICTS;
  let villages: string[] = VILLAGES;

  // Stores the filler may record this visit against: an officer scoped to one store gets exactly
  // that store (auto-set + locked); a regional manager gets their region's stores; admins/sysadmin
  // get every store — a mandatory pick, so a multi-store filler can never leave the store blank.
  let stores: { id: number; name: string }[] = [];
  try {
    const scope = await getScope();
    const where =
      scope.role === "officer" && scope.storeId != null
        ? { id: scope.storeId }
        : scope.role !== "central" && scope.role !== "sysadmin" && scope.zone
          ? { zone: scope.zone, status: "Active" }
          : { status: "Active" };
    let rows = await prisma.store.findMany({ where, select: { id: true, name: true }, orderBy: { name: "asc" } });
    // Never leave a filler with an empty mandatory picker (e.g. a region with no active stores).
    if (rows.length === 0) rows = await prisma.store.findMany({ where: { status: "Active" }, select: { id: true, name: true }, orderBy: { name: "asc" } });
    stores = rows.map((s) => ({ id: s.id, name: s.name.replace(/\s*\(.*?\)\s*/g, "").trim() || s.name }));
  } catch {
    // Tolerate a missing DB — the wizard then shows an "All stores" empty pick and validates client-side.
  }

  try {
    const [fieldRows, distRows, villRows] = await Promise.all([
      prisma.fieldOption.findMany({ select: { fieldName: true, options: true } }),
      prisma.farmer.findMany({
        where: { district: { not: null } },
        distinct: ["district"],
        select: { district: true },
        orderBy: { district: "asc" },
      }),
      prisma.farmer.findMany({
        where: { village: { not: null } },
        distinct: ["village"],
        select: { village: true },
        orderBy: { village: "asc" },
        take: 1500,
      }),
    ]);
    options = resolveOptions(fieldRows);
    const d = distRows.map((r) => r.district!).filter((s) => s.trim());
    const v = villRows.map((r) => r.village!).filter((s) => s.trim());
    if (d.length) districts = d;
    if (v.length) villages = v;
  } catch {
    // Tolerate a missing/empty DB — fall back to the spec's default option lists.
  }

  // WhatsApp opt-in QR shown on the last step — the officer has the farmer scan it to opt in.
  let optInQr: string | null = null;
  try { optInQr = (await getOptInQrConfig()).qr; } catch { /* no config / DB down → no QR */ }

  return (
    <NewVisitWizard
      options={options}
      districts={districts}
      villages={villages}
      visitReasons={VISIT_REASONS}
      stores={stores}
      optInQr={optInQr}
    />
  );
}
