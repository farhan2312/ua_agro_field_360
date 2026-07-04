"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getPersona } from "@/lib/session";
import { STATS_TAG } from "@/lib/stats";
import {
  LEAD_LABEL_TO_ENUM,
  SEGMENT_ENUM_TO_LABEL,
  LEAD_ENUM_TO_LABEL,
  type LeadStatusLabel,
} from "@/lib/segments";
import { inr } from "@/lib/format";
import type { VisitForm, FarmerLookupResult } from "@/components/new-visit/types";

/** Map the wizard lead-status label to the Prisma LeadStatus enum (best effort). */
function leadEnum(label: string): string | undefined {
  return LEAD_LABEL_TO_ENUM[label as LeadStatusLabel];
}

/**
 * Look up a registered farmer by mobile number (across ALL farmers) so the wizard
 * can autofill and edit the existing record. Prefers the enriched (DEMO) row when
 * a number is shared.
 */
export async function lookupFarmerByMobile(mobile: string): Promise<FarmerLookupResult> {
  const m = mobile.trim();
  if (m.length < 10) return { found: false };
  try {
    const f = await prisma.farmer.findFirst({
      where: { mobile: m },
      orderBy: [{ source: "asc" }, { id: "asc" }], // DEMO before REAL
      select: {
        id: true,
        name: true,
        village: true,
        district: true,
        crop: true,
        segment: true,
        leadStatus: true,
      },
    });
    if (!f) return { found: false };

    const [agg, lastVisit] = await Promise.all([
      prisma.sale.aggregate({ where: { farmerId: f.id }, _sum: { amountNum: true } }),
      prisma.visit.findFirst({
        where: { farmerId: f.id },
        orderBy: [{ visitedAt: "desc" }, { id: "desc" }],
        select: { date: true },
      }),
    ]);

    return {
      found: true,
      farmer: {
        id: f.id,
        name: f.name,
        village: f.village ?? "",
        district: f.district ?? "",
        mainCrop: f.crop ?? "",
        segmentLabel: f.segment ? SEGMENT_ENUM_TO_LABEL[f.segment] ?? null : null,
        leadStatusLabel: f.leadStatus ? LEAD_ENUM_TO_LABEL[f.leadStatus] ?? null : null,
        ltv: agg._sum.amountNum ? inr(agg._sum.amountNum) : "—",
        lastVisit: lastVisit?.date ?? "—",
      },
    };
  } catch {
    return { found: false };
  }
}

/**
 * Persist a New Visit. When `editingFarmerId` is supplied (an existing farmer was
 * pulled up by mobile) the farmer record is UPDATED; otherwise a farmer is created
 * (or matched by mobile). Then the Visit log entry is created. Tolerant of a
 * missing DB — always routes onward.
 */
export async function submitVisitAction(
  form: VisitForm,
  editingFarmerId?: number | null,
): Promise<void> {
  const persona = await getPersona();
  const officerName = persona.name;

  try {
    let farmerId: number | undefined;
    const mobile = form.mobile.trim();
    const lead = leadEnum(form.leadStatus);

    const editData = {
      name: form.name || undefined,
      village: form.village || null,
      district: form.district || null,
      crop: form.mainCrop || null,
      issues: form.currentProblem,
      ...(lead ? { leadStatus: lead as never } : {}),
      ...(mobile ? { mobile } : {}),
    };

    if (editingFarmerId) {
      // Edit the pulled-up record directly.
      const updated = await prisma.farmer.update({
        where: { id: editingFarmerId },
        data: editData,
      });
      farmerId = updated.id;
    } else if (mobile.length > 0) {
      const existing = await prisma.farmer.findFirst({ where: { mobile } });
      if (existing) {
        const updated = await prisma.farmer.update({
          where: { id: existing.id },
          data: editData,
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
            source: "REAL",
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
        // Service detail — only stored when the matching toggle is on.
        fpoName: form.fpoMember ? form.serviceDetail.fpoMember?.trim() || null : null,
        contractDetail: form.contractFarming
          ? form.serviceDetail.contractFarming?.trim() || null
          : null,
        dairyDetail: form.dairyServices
          ? form.serviceDetail.dairyServices?.trim() || null
          : null,
        whatsappNumber: form.whatsappAvail
          ? form.serviceDetail.whatsappAvail?.trim() || null
          : null,
        photos: form.photos,
        voiceNotes: form.voiceNotes,
        visitedAt: new Date(),
        source: "REAL",
      },
    });

    await prisma.auditLog.create({
      data: {
        actor: officerName,
        action: editingFarmerId ? "UPDATE" : "CREATE",
        entity: "Visit",
        detail: `${editingFarmerId ? "Updated farmer + logged visit" : "New visit logged"}${
          form.name ? ` for ${form.name}` : ""
        }`,
      },
    });

    revalidatePath("/visits");
    revalidatePath("/dashboard");
    // Farmer count / segment summary may have changed — bust the cached stats.
    revalidateTag(STATS_TAG);
  } catch {
    // Tolerate a missing/empty DB — still route the officer onward.
  }

  redirect("/dashboard");
}
