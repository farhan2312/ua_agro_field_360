// Client-safe: the "contacted in an earlier round" record shown as a tag on round 2+ campaign lists.
// Rows come from CampaignMemberRound (snapshotted when a campaign advances — see lib/campaign-member-rounds.ts).

export interface PrevRoundContact {
  round: number; roundName: string;
  reached: boolean; mediums: string[];
  response: string | null; responseCrop: string | null; comment: string | null;
  at: string | null; // when that round's outcome was recorded (ISO)
  by: string | null; // who recorded it ("Name (CODE)")
}

const MED: Record<string, string> = { CALL: "Call", WHATSAPP: "WhatsApp", SMS: "SMS", IN_PERSON: "In-person", UNREACHABLE: "Unreachable" };
const RESP: Record<string, string> = { INTERESTED: "Interested", NOT_INTERESTED: "Not interested", OTHER_CROP: "Wants another crop" };

export const prevMediums = (p: PrevRoundContact) => p.mediums.map((m) => MED[m] ?? m).join(" + ");
export const prevResponse = (p: PrevRoundContact) => (p.response ? RESP[p.response] ?? p.response : "");
export const prevUnreachable = (p: PrevRoundContact) => !p.reached && p.mediums.includes("UNREACHABLE");

/** Short tag text for the most recent earlier round, e.g. "R1 · Interested", "R1 · Called", "R1 · Unreachable". */
export function prevTagText(p: PrevRoundContact): string {
  const what = prevResponse(p) || (prevUnreachable(p) ? "Unreachable" : p.reached ? "Contacted" : "Note");
  return `R${p.round} · ${what}`;
}
