import { segMeta } from "@/lib/campaign-segments";
import { inr, initials, avatarColor } from "@/lib/format";
import { statusColor } from "@/lib/status";

export interface ScopedKpi { farmers: number; hni: number; potentialHni: number; revenue12m: number; visits: number }
export interface ScopedSegBar { key: string; label: string; count: number; color: string; bg: string }
export interface ScopedRecentVisit { id: number; farmer: string; village: string; officer: string; date: string; status: string }
export interface ScopedDashboardData {
  kind: "store" | "zone" | "global";
  label: string; // store name, region name, or "All regions"
  sub: string; // secondary line
  kpi: ScopedKpi;
  segments: ScopedSegBar[];
  recent: ScopedRecentVisit[];
}

const n = (x: number) => x.toLocaleString("en-IN");
const CARD = "rounded-[14px] border border-black/[0.04] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]";

/** Overview strip — every figure is real and scoped: officer→store, RM→region, central/sysadmin→org-wide. */
export function ScopedDashboard({ data, name }: { data: ScopedDashboardData; name: string }) {
  const scopeChip = data.kind === "store" ? "My store only" : data.kind === "zone" ? "My region only" : "Organization-wide";
  const kpiChip = data.kind === "store" ? "Store" : data.kind === "zone" ? "Region" : "All";
  const kpis = [
    { label: data.kind === "store" ? "Farmers in store" : data.kind === "zone" ? "Farmers in region" : "Farmers (all regions)", value: n(data.kpi.farmers), color: "#2E7D32", bg: "#E8F5E9" },
    { label: "HNI farmers", value: n(data.kpi.hni), color: "#6A1B9A", bg: "#F3E5F5" },
    { label: "12-mo revenue", value: inr(data.kpi.revenue12m), color: "#1565C0", bg: "#E3F2FD" },
    { label: "Visits logged", value: n(data.kpi.visits), color: "#E65100", bg: "#FFF3E0" },
  ];
  const segMax = Math.max(1, ...data.segments.map((s) => s.count));

  return (
    <div>
      {/* Scope header */}
      <div className={`${CARD} mb-5 overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-[#1B5E20] to-[#2E7D32] px-5 py-4">
          <div className="min-w-0">
            <div className="text-[12px] font-medium text-white/70">Namaste, {name}</div>
            <div className="truncate text-[18px] font-bold text-white">{data.label}</div>
            <div className="mt-0.5 text-[12px] text-white/80">{data.sub}</div>
          </div>
          <span className="shrink-0 rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold text-white">
            {scopeChip}
          </span>
        </div>
      </div>

      {/* Scoped KPI row */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className={`${CARD} px-4 py-3.5`}>
            <div className="mb-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: k.bg, color: k.color }}>{kpiChip}</div>
            <div className="text-[22px] font-bold text-[#1A1C1A]">{k.value}</div>
            <div className="text-[11.5px] text-[#757575]">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Segment mix */}
        <div className={`${CARD} p-5`}>
          <div className="mb-3 text-[14px] font-bold text-[#1A1C1A]">Segment mix</div>
          {data.segments.length === 0 ? (
            <div className="py-6 text-center text-[12.5px] text-[#9E9E9E]">No segmented farmers yet.</div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {data.segments.map((s) => (
                <div key={s.key} className="flex items-center gap-3">
                  <div className="w-28 shrink-0 truncate text-[12px] font-semibold" style={{ color: s.color }}>{s.label}</div>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[#F1F1F1]">
                    <div className="h-full rounded-full" style={{ width: `${(s.count / segMax) * 100}%`, background: s.color }} />
                  </div>
                  <div className="w-12 shrink-0 text-right text-[12px] font-bold text-[#1A1C1A]">{n(s.count)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent visits (scoped) */}
        <div className={`${CARD} p-5`}>
          <div className="mb-3 text-[14px] font-bold text-[#1A1C1A]">Recent visits</div>
          {data.recent.length === 0 ? (
            <div className="py-6 text-center text-[12.5px] text-[#9E9E9E]">No visits logged yet.</div>
          ) : (
            <div className="flex flex-col">
              {data.recent.map((v, i) => {
                const sc = statusColor(v.status);
                return (
                  <div key={v.id} className="flex items-center gap-3 border-b border-[#F5F5F5] py-2 last:border-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: avatarColor(i) }}>{initials(v.farmer)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-semibold text-[#1A1C1A]">{v.farmer}</div>
                      <div className="truncate text-[11px] text-[#9E9E9E]">{v.village} · {v.officer} · {v.date}</div>
                    </div>
                    <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: sc.bg, color: sc.c }}>{v.status}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Shown when a scoped user has no store/region assigned — they must not fall through to global data. */
export function UnassignedDashboard({ name, kind }: { name: string; kind: "store" | "region" }) {
  return (
    <div className={`${CARD} p-8 text-center`}>
      <div className="text-[15px] font-bold text-[#1A1C1A]">Namaste, {name}</div>
      <div className="mx-auto mt-2 max-w-[420px] text-[13px] text-[#757575]">
        No {kind} is assigned to your account yet, so there's no data to show. Ask a System Admin to link your account to a {kind} on the Users page.
      </div>
    </div>
  );
}
