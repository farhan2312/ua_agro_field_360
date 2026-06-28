"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

/** Save the editable fields of a user (System-Admin Edit modal). */
export async function saveUser(input: {
  id: number;
  name: string;
  roleLabel: string;
  territory: string;
  active: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.user.update({
      where: { id: input.id },
      data: {
        name: input.name.trim(),
        roleLabel: input.roleLabel.trim() || null,
        territory: input.territory.trim() || null,
        active: input.active,
      },
    });
    revalidatePath("/users");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed" };
  }
}
