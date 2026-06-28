"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getPersona } from "@/lib/session";
import { LEAD_LABEL_TO_ENUM, type LeadStatusLabel } from "@/lib/segments";
import type { VisitForm } from "@/components/new-visit/types";

/** Map the wizard lead-status label to the Prisma LeadStatus enum (best effort). */
function leadEnum(label: string): string | undefined {
  return LEAD_LABEL_TO_ENUM[label as LeadStatusLabel];
}

/**
 * Persist a New Visit: upsert a Farmer (by mobile, when supplied) and create the
 * Visit log entry, then audit + redirect to the dashboard. Wrapped so a missing
 * DB cannot crash the wizard — on failure we still route to /dashboard.
 */
export async function submitVisitAction(form: VisitForm): Promise<void> {
  const persona = getPersona();
  const officerName = persona.name;

  try {
    let farmerId: number | undefined;
    const mobile = form.mobile.trim();

    if (mobile.length > 0) {
      const existing = await prisma.farmer.findFirst({ where: { mobile } });
      const lead = leadEnum(form.leadStatus);
      if (existing) {
        const updated = await prisma.farmer.update({
          where: { id: existing.id },
          data: {
            name: form.name || existing.name,
            village: form.village || existing.village,
            district: form.district || existing.district,
            crop: form.mainCrop || existing.crop,
            issues: form.currentProblem,
            ...(lead ? { leadStatus: lead as never } : {}),
          },
        });
        farmerId = updated.id;
      } else {
        const created = await prisma.farmer.create({
          data: {
            code: `FARM-NV-${Date.now()}`,
            name: form.name || "New Farmer",
            mobile,
            village: form.village || null,
            district: form.district || null,
            crop: form.mainCrop || null,
            issues: form.currentProblem,
            ...(lead ? { leadStatus: lead as never } : {}),
            source: "DEMO",
          },
        });
        farmerId = created.id;
      }
    }

    await prisma.visit.create({
      data: {
        farmerId,
        officerName,
        purpose: form.visitPurpose || null,
        type: form.visitPurpose || null,
        gpsLat: 27.1767,
        gpsLng: 78.0081,
        soilType: form.soil || null,
        soilTesting: form.soilTesting || null,
        waterSource: form.waterSource,
        mainCrop: form.mainCrop || null,
        crops: form.crop,
        otherCrops: form.otherCrops || null,
        season: form.season || null,
        cropInsured: form.cropInsured,
        landHoldingUnit: form.landHolding || null,
        products: form.product,
        productRequired: form.productRequired,
        currentProblem: form.currentProblem,
        cropRisk: form.cropRisk,
        dangerZone: form.dangerZone,
        annualExpense: form.annualExpense || null,
        purchaseFreq: form.purchaseFreq || null,
        otherShops: form.otherShops || null,
        fpoMember: form.fpoMember,
        contractFarming: form.contractFarming,
        dairyServices: form.dairyServices,
        whatsappAvail: form.whatsappAvail,
        visitedAt: new Date(),
        source: "DEMO",
      },
    });

    await prisma.auditLog.create({
      data: {
        actor: officerName,
        action: "CREATE",
        entity: "Visit",
        detail: `New visit logged${form.name ? ` for ${form.name}` : ""}`,
      },
    });

    revalidatePath("/visits");
    revalidatePath("/dashboard");
  } catch {
    // Tolerate a missing/empty DB — still route the officer onward.
  }

  redirect("/dashboard");
}
