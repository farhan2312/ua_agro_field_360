import type { NewFarmerAcq } from "@/app/actions/analytics-segments";

const CARD = "rounded-[14px] border border-black/[0.04] bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]";
const n = (x: number) => x.toLocaleString("en-IN");

// Distinct colours for the top villages; Other / Unknown use neutral greys.
const PALETTE = [
  "#2E7D32", "#1565C0", "#6A1B9A", "#E65100", "#00838F", "#C62828", "#5E35B1", "#00897B", "#F9A825", "#3949AB",
  "#7CB342", "#D81B60", "#0097A7", "#8D6E63", "#AFB42B", "#512DA8", "#00695C", "#EF6C00", "#AD1457", "#283593",
];
const OTHER_COLOR = "#90A4AE", UNKNOWN_COLOR = "#CFD8DC";

function colorOf(village: string, idx: number): string {
  if (village === "Other") return OTHER_COLOR;
  if (village === "Unknown") return UNKNOWN_COLOR;
  return PALETTE[idx % PALETTE.length];
}

/**
 * New customers created from a sale (no prior registration — code FARM-C-*), by first-purchase month,
 * stacked by village. Pure SVG so it renders server-side; native <title> tooltips on each segment.
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
  const villageColor = new Map(data.villages.map((v, i) => [v, colorOf(v, i)]));
  const max = Math.max(1, ...data.months.map((m) => m.total));
  const H = 130, BW = 30, GAP = 12, PAD_L = 2;
  const chartW = data.months.length * (BW + GAP) + PAD_L;

  return (
    <div className={CARD}>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[13px] font-bold text-[#1A1C1A]">New customers from sales</div>
        <div className="text-[11px] text-[#9E9E9E]"><b className="text-[#2E7D32]">{n(data.total)}</b> farmers · {n(data.distinctVillages)} villages · by first-purchase month, stacked by village (top 20)</div>
      </div>

      <div className="overflow-x-auto">
        <svg width={chartW} height={H + 26} className="block">
          <line x1={0} y1={3} x2={chartW} y2={3} stroke="#F0F0F0" />
          {data.months.map((mo, i) => {
            const x = PAD_L + i * (BW + GAP);
            let yCursor = H + 3; // stack upward from the baseline
            return (
              <g key={mo.ym}>
                {data.villages.map((v) => {
                  const c = mo.counts[v] ?? 0;
                  if (c <= 0) return null;
                  const h = (c / max) * H;
                  yCursor -= h;
                  return <rect key={v} x={x} y={yCursor} width={BW} height={h} fill={villageColor.get(v)}><title>{`${mo.label} · ${v}: ${n(c)}`}</title></rect>;
                })}
                <text x={x + BW / 2} y={yCursor - 3} textAnchor="middle" fontSize={8.5} className="fill-[#616161]" fontWeight={700}>{n(mo.total)}</text>
                <text x={x + BW / 2} y={H + 17} textAnchor="middle" fontSize={8.5} className="fill-[#9E9E9E]">{mo.label}</text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 border-t border-[#F3F3F3] pt-2.5">
        {data.villages.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 text-[10px] text-[#616161]">
            <span className="h-[9px] w-[9px] rounded-[2px]" style={{ background: villageColor.get(v) }} />
            {v}
          </span>
        ))}
      </div>
    </div>
  );
}
