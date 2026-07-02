import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getRole } from "@/lib/session";
import { SEGMENT_ENUM_TO_LABEL } from "@/lib/segments";
import { NewVisitWizard } from "@/components/new-visit/NewVisitWizard";
import { resolveOptions, type WizardOptions } from "@/components/new-visit/field-options";
import type { LookupFarmer } from "@/components/new-visit/types";

export default async function NewVisitPage() {
  // Route guard: the `central` persona has no New Visit nav entry (spec §1).
  const role = await getRole();
  if (role === "central") redirect("/dashboard");

  let options: WizardOptions = resolveOptions([]);
  let farmers: LookupFarmer[] = [];

  try {
    const [fieldRows, demoFarmers] = await Promise.all([
      prisma.fieldOption.findMany({ select: { fieldName: true, options: true } }),
      // Mobile lookup only needs the enriched demo set (real farmers lack mobile/segment).
      prisma.farmer.findMany({
        where: { source: "DEMO", mobile: { not: null } },
        select: {
          id: true,
          name: true,
          mobile: true,
          village: true,
          district: true,
          crop: true,
          segment: true,
        },
        take: 200,
      }),
    ]);

    options = resolveOptions(fieldRows);
    farmers = demoFarmers.map((f) => ({
      id: f.id,
      name: f.name,
      mobile: f.mobile,
      village: f.village,
      district: f.district,
      crop: f.crop,
      segmentLabel: f.segment ? SEGMENT_ENUM_TO_LABEL[f.segment] ?? null : null,
    }));
  } catch {
    // Tolerate a missing/empty DB — fall back to spec option lists, no lookup.
  }

  return <NewVisitWizard options={options} farmers={farmers} />;
}
