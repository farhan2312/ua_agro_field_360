/** Shared Action-registry enums, reasons + view-model (kept out of the "use server" actions file). */

/**
 * Start of "today" (server-local midnight) — the single, shared overdue cutoff. An action is OVERDUE
 * only when its dueDate is strictly before this: a follow-up due *today* is still due, not overdue.
 * Every overdue count in the app (Action Registry, Store 360, Overall + leaderboards) must use this so
 * the numbers agree — using `new Date()` instead wrongly flags all of today's follow-ups as overdue.
 */
export const startOfToday = (): Date => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

export const ACTION_STATUSES = ["OPEN", "DONE"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

/** Follow-up reasons — used by the visit form dropdown AND the manual "New action" form. */
export const FOLLOWUP_REASONS = [
  "Order Booking",
  "Product Demonstration",
  "Payment Collection",
  "Crop Stage Check",
  "Advisory / Recommendation",
  "Complaint / Issue Resolution",
  "Scheme / Subsidy Info",
  "Soil Test Result",
  "New Product Introduction",
  "Re-visit",
  "Other",
] as const;

export interface ActionVM {
  id: number;
  farmerId: number | null;
  farmerName: string;
  farmerMobile: string;
  farmerVillage: string;
  lastVisit: string | null; // ISO date of the farmer's most recent visit (null = never)
  storeId: number | null;
  storeName: string;
  district: string;
  visitId: number | null;
  reason: string;
  note: string;
  workingComment: string; // latest working comment (full history via getActionComments)
  dueDate: string;   // ISO "YYYY-MM-DD"
  status: string;    // OPEN | DONE
  overdue: boolean;  // OPEN and past due
  createdBy: string;
  createdAt: string; // ISO
  completedBy: string;
  completedAt: string | null;
  completionNote: string;
}

export interface FarmerPick {
  id: number;
  name: string;
  mobile: string;
  village: string;
  storeId: number | null;
  storeName: string;
}
