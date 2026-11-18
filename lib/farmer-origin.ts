// How a farmer record came into Field360, from its code pattern, its SalesImport link and the timing of
// the ERP sync run that created it. Server-only helpers + client-safe labels.
//   FARM-NV-*            → New Visit form (field officer)
//   FARM-C-* + importId  → Excel sales upload (SalesImport)
//   FARM-C-* (no import) → ERP sync — daily scheduled / manual run / 2-year backfill (ErpSyncRun timing)
//   FARMQ127-*, C<phone>, FARM<n> → initial data migration (Jun–Jul 2026)

export type OriginKey = "ERP_DAILY" | "ERP_MANUAL" | "ERP_BACKFILL" | "VISIT" | "IMPORT" | "MIGRATION" | "OTHER";

export const ORIGIN_LABEL: Record<OriginKey, string> = {
  ERP_DAILY: "ERP daily sync — bought at a store",
  ERP_MANUAL: "ERP sync — manual run",
  ERP_BACKFILL: "ERP backfill (2-year history)",
  VISIT: "New Visit — added by a field officer",
  IMPORT: "Excel sales upload",
  MIGRATION: "Initial data migration",
  OTHER: "Other",
};
export const ORIGIN_COLOR: Record<OriginKey, string> = {
  ERP_DAILY: "#1565C0", ERP_MANUAL: "#5C6BC0", ERP_BACKFILL: "#7986CB", VISIT: "#2E7D32", IMPORT: "#EF6C00", MIGRATION: "#757575", OTHER: "#9E9E9E",
};

export interface SyncRunLite { id: number; fromDate: string; toDate: string; triggeredBy: string | null; createdAt: Date; durationMs: number | null }

/** The ERP run that created a farmer at `createdAt`: the run in progress then, else the latest run before it. */
export function matchRun(runs: SyncRunLite[], createdAt: Date): SyncRunLite | null {
  const t = createdAt.getTime();
  const prior = runs.filter((r) => r.createdAt.getTime() <= t + 1000).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return prior.find((r) => t - r.createdAt.getTime() <= (r.durationMs ?? 0) + 600_000) ?? prior[0] ?? null;
}

export function originOf(f: { code: string; importId: number | null; createdAt: Date }, runs: SyncRunLite[]): { key: OriginKey; run: SyncRunLite | null } {
  const c = f.code;
  if (c.startsWith("FARM-NV-")) return { key: "VISIT", run: null };
  if (c.startsWith("FARM-C-") && f.importId != null) return { key: "IMPORT", run: null };
  if (c.startsWith("FARM-C-")) {
    const run = matchRun(runs, f.createdAt);
    const kind = run?.triggeredBy?.split(":")[0] ?? "schedule";
    return { key: kind === "manual" ? "ERP_MANUAL" : kind === "backfill" ? "ERP_BACKFILL" : "ERP_DAILY", run };
  }
  if (c.startsWith("FARMQ127-") || /^C\d{10}$/.test(c) || /^FARM/.test(c)) return { key: "MIGRATION", run: null };
  return { key: "OTHER", run: null };
}

/** SQL CASE (Farmer alias `f`) for the coarse origin bucket — ERP sub-kinds need run timing, so they share "ERP". */
export const ORIGIN_SQL_CASE = `CASE WHEN f.code LIKE 'FARM-NV-%' THEN 'VISIT'
  WHEN f.code LIKE 'FARM-C-%' AND f."importId" IS NOT NULL THEN 'IMPORT'
  WHEN f.code LIKE 'FARM-C-%' THEN 'ERP'
  ELSE 'MIGRATION' END`;
