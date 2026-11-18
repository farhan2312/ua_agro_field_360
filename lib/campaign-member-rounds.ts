// Server-only: per-round outreach snapshots (CampaignMemberRound). When a campaign advances, every
// member's live outcome is copied here for the finished round and then cleared, so the next round starts
// with everyone pending while the earlier conversation stays visible.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { PrevRoundContact } from "@/lib/campaign-prev-round";

type Tx = Prisma.TransactionClient;

/** Snapshot every member with a recorded outcome/note for `round`, then clear the live outcome. */
export async function snapshotAndResetRound(tx: Tx, campaignId: number, round: number): Promise<number> {
  const saved = await tx.$executeRaw(Prisma.sql`
    INSERT INTO "CampaignMemberRound"
      ("campaignId","memberId","farmerId","round","reached","mediums","response","responseCrop","comment","reachedAt","reachedBy","reachedByCode")
    SELECT "campaignId","id","farmerId",${round},"reached","mediums","response","responseCrop","comment","reachedAt","reachedBy","reachedByCode"
    FROM "CampaignMember"
    WHERE "campaignId" = ${campaignId} AND "group" = 'TEST'
      AND ("reachedAt" IS NOT NULL OR "comment" IS NOT NULL OR "response" IS NOT NULL OR cardinality("mediums") > 0)
    ON CONFLICT ("memberId","round") DO NOTHING`);
  await tx.campaignMember.updateMany({
    where: { campaignId },
    data: { reached: false, reachedAt: null, mediums: [], reachedBy: null, reachedByCode: null, comment: null, response: null, responseCrop: null },
  });
  return saved;
}

/** Earlier-round contacts per member (oldest round first), for rounds before `beforeRound`. */
export async function loadPrevRounds(campaignId: number, beforeRound: number, memberIds?: number[]): Promise<Map<number, PrevRoundContact[]>> {
  const out = new Map<number, PrevRoundContact[]>();
  if (beforeRound < 2) return out;
  const [rows, phases] = await Promise.all([
    prisma.campaignMemberRound.findMany({
      where: { campaignId, round: { lt: beforeRound }, ...(memberIds ? { memberId: { in: memberIds } } : {}) },
      orderBy: [{ memberId: "asc" }, { round: "asc" }],
    }),
    prisma.campaignPhase.findMany({ where: { campaignId }, select: { ordinal: true, name: true } }),
  ]);
  const pname = new Map(phases.map((p) => [p.ordinal, p.name]));
  for (const r of rows) {
    const list = out.get(r.memberId) ?? out.set(r.memberId, []).get(r.memberId)!;
    list.push({
      round: r.round, roundName: pname.get(r.round) ?? `Round ${r.round}`,
      reached: r.reached, mediums: r.mediums, response: r.response, responseCrop: r.responseCrop, comment: r.comment,
      at: r.reachedAt ? r.reachedAt.toISOString() : null,
      by: r.reachedBy ? `${r.reachedBy}${r.reachedByCode ? ` (${r.reachedByCode})` : ""}` : null,
    });
  }
  return out;
}

/** Members reached in ANY earlier round → their latest reached snapshot (keeps tracker reach/uplift cumulative). */
export async function earlierReached(campaignId: number): Promise<Map<number, { mediums: string[]; response: string | null; responseCrop: string | null }>> {
  const rows = await prisma.campaignMemberRound.findMany({
    where: { campaignId, reached: true }, orderBy: { round: "asc" },
    select: { memberId: true, mediums: true, response: true, responseCrop: true },
  });
  return new Map(rows.map((r) => [r.memberId, { mediums: r.mediums, response: r.response, responseCrop: r.responseCrop }]));
}
