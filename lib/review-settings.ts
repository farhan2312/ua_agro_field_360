import { prisma } from "@/lib/prisma";

/** Review SLA — hours from when a visit is logged until it should be reviewed. Editable in Settings (Phase 4). */
export const REVIEW_SLA_KEY = "review.slaHours";
export const DEFAULT_SLA_HOURS = 48;

export async function getReviewSlaHours(): Promise<number> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: REVIEW_SLA_KEY } });
    const n = Number(row?.value);
    return Number.isFinite(n) && n > 0 && n <= 24 * 60 ? n : DEFAULT_SLA_HOURS;
  } catch {
    return DEFAULT_SLA_HOURS;
  }
}
