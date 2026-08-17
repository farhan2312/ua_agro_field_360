"use client";

import { useState } from "react";
import { AuditTable, type AuditRowData } from "./AuditTable";
import { EmployeeActivity } from "./EmployeeActivity";

type Tab = "activity" | "log";

/** Audit page shell: employee activity analytics + the raw audit log. */
export function AuditScreen({ auditRows }: { auditRows: AuditRowData[] }) {
  const [tab, setTab] = useState<Tab>("activity");
  return (
    <div className="animate-fadeUp">
      <div className="mb-5 flex flex-wrap gap-1 border-b border-[#ECECEC]">
        {([["activity", "👥 Employee Activity"], ["log", "📋 Audit Log"]] as [Tab, string][]).map(([k, l]) => {
          const on = tab === k;
          return (
            <button key={k} type="button" onClick={() => setTab(k)}
              className="relative px-4 py-2.5 text-[13px] font-semibold transition-colors"
              style={{ color: on ? "#2E7D32" : "#9E9E9E" }}>
              {l}
              {on && <span className="absolute inset-x-2 -bottom-px h-[2.5px] rounded-full bg-[#2E7D32]" />}
            </button>
          );
        })}
      </div>
      {tab === "activity" ? <EmployeeActivity /> : <AuditTable rows={auditRows} />}
    </div>
  );
}
