import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getRole } from "@/lib/session";
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

  return (
    <NewVisitWizard
      options={options}
      districts={districts}
      villages={villages}
      visitReasons={VISIT_REASONS}
    />
  );
}
