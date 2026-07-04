import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getRole } from "@/lib/session";
import { NewVisitWizard } from "@/components/new-visit/NewVisitWizard";
import { resolveOptions, type WizardOptions } from "@/components/new-visit/field-options";

export const dynamic = "force-dynamic";

export default async function NewVisitPage() {
  // Route guard: the `central` persona has no New Visit nav entry (spec §1).
  const role = await getRole();
  if (role === "central") redirect("/dashboard");

  let options: WizardOptions = resolveOptions([]);
  try {
    const fieldRows = await prisma.fieldOption.findMany({
      select: { fieldName: true, options: true },
    });
    options = resolveOptions(fieldRows);
  } catch {
    // Tolerate a missing/empty DB — fall back to the spec's default option lists.
  }

  return <NewVisitWizard options={options} />;
}
