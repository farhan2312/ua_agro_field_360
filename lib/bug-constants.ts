/** Shared Bug enums + view-model (kept out of the "use server" actions file, which may only export async fns). */

export const BUG_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const BUG_STATUSES = ["OPEN", "IN_PROGRESS", "TESTING", "FIXED", "CLOSED"] as const;
export type BugSeverity = (typeof BUG_SEVERITIES)[number];
export type BugStatus = (typeof BUG_STATUSES)[number];

export interface BugVM {
  id: number;
  title: string;
  description: string;
  severity: string;
  status: string;
  page: string;
  reporter: string;
  reporterCode: string;
  hasScreenshot: boolean;
  resolution: string;
  createdAt: string; // ISO
  resolvedAt: string | null;
}
