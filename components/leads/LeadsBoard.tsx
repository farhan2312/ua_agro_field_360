import { LeadColumn } from "./LeadColumn";
import { LeadFunnel } from "./LeadFunnel";
import { EmptyState } from "@/components/ui";
import type { LeadColumnData } from "./types";

/**
 * Leads Pipeline board: read-only kanban grouped by lead status,
 * preceded by the org lead-funnel summary.
 *
 * Layout note: the original design declares `grid-template-columns:repeat(5,1fr)`
 * for 4 data columns, leaving a blank 5th track. Kept here (`grid-cols-5`) for
 * pixel fidelity with the source slice.
 */
export function LeadsBoard({ columns }: { columns: LeadColumnData[] }) {
  const total = columns.reduce((n, c) => n + c.count, 0);

  return (
    <div className="animate-fadeUp">
      <LeadFunnel />

      {total === 0 ? (
        <EmptyState
          title="No leads to show"
          hint="Lead cards appear here once farmers are assigned a lead status."
        />
      ) : (
        <div className="grid grid-cols-5 gap-3.5">
          {columns.map((col) => (
            <LeadColumn
              key={col.key}
              title={col.title}
              color={col.color}
              count={col.count}
              items={col.items}
            />
          ))}
        </div>
      )}
    </div>
  );
}
