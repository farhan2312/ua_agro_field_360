"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { SEGMENT_LABEL_TO_ENUM, type SegmentLabel } from "@/lib/segments";

/** Persist Store edits from the System-Admin edit modal. */
export async function saveStoreAction(input: {
  id: number;
  name: string;
  address: string;
  zone: string;
}) {
  try {
    await prisma.store.update({
      where: { id: input.id },
      data: {
        name: input.name.trim(),
        address: input.address.trim() || null,
        zone: input.zone.trim() || null,
      },
    });
    revalidatePath("/master-data");
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "Could not save store." };
  }
}

/** Persist Farmer edits from the System-Admin edit modal. */
export async function saveFarmerAction(input: {
  id: number;
  name: string;
  mobile: string;
  village: string;
  district: string;
  crop: string;
  segment: string;
}) {
  try {
    const segEnum =
      input.segment && input.segment in SEGMENT_LABEL_TO_ENUM
        ? (SEGMENT_LABEL_TO_ENUM[input.segment as SegmentLabel] as
            | "HIGH_VALUE"
            | "MEDIUM_VALUE"
            | "NEW_LOW"
            | "DORMANT")
        : null;
    await prisma.farmer.update({
      where: { id: input.id },
      data: {
        name: input.name.trim(),
        mobile: input.mobile.trim() || null,
        village: input.village.trim() || null,
        district: input.district.trim() || null,
        crop: input.crop.trim() || null,
        segment: segEnum,
      },
    });
    revalidatePath("/master-data");
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "Could not save farmer." };
  }
}
