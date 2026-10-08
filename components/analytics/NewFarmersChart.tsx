import type { NewFarmerAcq } from "@/app/actions/analytics-segments";

const CARD = "rounded-[14px] border border-black/[0.04] bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]";
const n = (x: number) => x.toLocaleString("en-IN");

// Distinct colours for the top villages; Other / Unknown use neutral greys.
const PALETTE = [
  "#2E7D32", "#1565C0", "#6A1B9A", "#E65100", "#00838F", "#C62828", "#5E35B1", "#00897B", "#F9A825", "#3949AB",
  "#7CB342", "#D81B60", "#0097A7", "#8D6E63", "#AFB42B", "#512DA8", "#00695C", "#EF6C00", "#AD1457", "#283593",
];
const OTHER_COLOR = "#90A4AE", UNASSIGNED_COLOR = "#CFD8DC";

function colorOf(key: string, idx: number): string {
  if (key === "Other") return OTHER_COLOR;
  if (key === "Unassigned") return UNASSIGNED_COLOR;
  return PALETTE[idx % PALETTE.length];
}

/**
 * New customers created from a sale (no prior registration — code FARM-C-*), by first-purchase month,
 * stacked by store. Pure SVG so it renders server-side; native <title> tooltips on each segment.
 */
export function NewFarmersChart({ data }: { data: NewFarmerAcq }) {
  if (!data.months.length) {
    return (
      <div className={CARD}>
        <div className="text-[14px] font-bold text-[#1A1C1A]">New customers from sales</div>
        <div className="mt-2 text-[12.5px] text-[#9E9E9E]">No sale-created customers in your scope yet.</div>
      </div>
    );
  }
  const keyColor = new Map(data.keys.map((k, i) => [k, colorOf(k, i)]));
  const max = Math.max(1, ...data.months.map((m) => m.total));
  // Horizontal stacked bars: one row per month. L = month-label gutter, R = total-label gutter.
  const W = 760, L = 62, R = 58, ROW = 20, GAP = 9;
  const barMaxW = W - L - R;
  const chartH = data.months.length * (ROW + GAP);

  return (
    <div className={CARD}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[13px] font-bold text-[#1A1C1A]">New customers from sales</div>
        <div className="text-[11px] text-[#9E9E9E]"><b className="text-[#2E7D32]">{n(data.total)}</b> farmers · {n(data.distinct)} stores · by first-purchase month, stacked by store (top 20)</div>
      </div>

      <div className="overflow-x-auto">
        <svg width={W} height={chartH} className="block">
          {data.months.map((mo, i) => {
            const y = i * (ROW + GAP);
            const barW = (mo.total / max) * barMaxW;
            let xCursor = L;
            return (
              <g key={mo.ym}>
                <text x={L - 6} y={y + ROW / 2} textAnchor="end" dominantBaseline="middle" fontSize={9.5} className="fill-[#616161]" fontWeight={600}>{mo.label}</text>
                {data.keys.map((v) => {
                  const c = mo.counts[v] ?? 0;
                  if (c <= 0) return null;
                  const w = (c / max) * barMaxW;
                  const seg = <rect key={v} x={xCursor} y={y} width={w} height={ROW} fill={keyColor.get(v)}><title>{`${mo.label} · ${v}: ${n(c)}`}</title></rect>;
                  xCursor += w;
                  return seg;
                })}
                <text x={L + barW + 5} y={y + ROW / 2} dominantBaseline="middle" fontSize={9.5} className="fill-[#1A1C1A]" fontWeight={700}>{n(mo.total)}</text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 border-t border-[#F3F3F3] pt-2.5">
        {data.keys.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 text-[10px] text-[#616161]">
            <span className="h-[9px] w-[9px] rounded-[2px]" style={{ background: keyColor.get(v) }} />
            {v}
          </span>
        ))}
      </div>
    </div>
  );
}
