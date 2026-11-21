// Server-only: who is still "to contact" once a campaign moves past Round 1.
//
// From Round 2 on, farmers who already bought during the campaign (any REAL purchase from the campaign
// start to its end date) are done — the contact list, Focus mode, the matrix and mass send only carry the
// "Not yet purchased" farmers. Same rule as the Round status screen, so the numbers match it.
import { prisma } from "@/lib/prisma";

/** Farmers (from a given set) who made ANY real purchase inside [from, to). */
export async function purchasedFarmerIds(farmerIds: number[], from: Date, to: Date): Promise<Set<number>> {
  if (!farmerIds.length) return new Set();
  const rows = await prisma.saleLine.findMany({
    where: { farmerId: { in: farmerIds }, source: "REAL", soldAt: { gte: from, lt: to } },
    select: { farmerId: true }, distinct: ["farmerId"],
  });
  return new Set(rows.map((r) => r.farmerId).filter((x): x is number => x != null));
}

/** The campaign's current round + the farmers to leave out of this round's outreach (empty in Round 1). */
export async function roundBuyersToSkip(campaignId: number, farmerIds: number[]): Promise<{ round: number; skip: Set<number> }> {
  const camp = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { currentRound: true, startDate: true, endDate: true, phases: { select: { ordinal: true } } },
  });
  if (!camp || !camp.phases.length) return { round: 1, skip: new Set() };
  const round = Math.min(Math.max(1, camp.currentRound), Math.max(...camp.phases.map((p) => p.ordinal)));
  if (round < 2) return { round, skip: new Set() };
  return { round, skip: await purchasedFarmerIds(farmerIds, camp.startDate, new Date(camp.endDate.getTime() + 864e5)) };
}
