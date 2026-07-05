/**
 * Hero KPI strip (lines 441–462). 4 hardcoded cells with green gradient bg.
 * Values are the original design literals (visits / avg per ASR / conv / completeness).
 */
const CELLS = [
  { label: "Visits This Period", value: "847", sub: "↑ 12.3% vs last period" },
  { label: "Avg Visits / ASR", value: "14.2", sub: "↑ 2.1 vs target of 12" },
  { label: "Conversion Rate", value: "42.3%", sub: "↑ 3.2pp vs last period" },
  { label: "Data Completeness", value: "84%", sub: "↑ 6pp improvement" },
];

export function HeroKpiBanner() {
  return (
    <div className="rounded-[14px] px-5 py-[18px] mb-5 grid grid-cols-2 gap-5 text-white bg-[linear-gradient(135deg,#1B5E20,#2E7D32,#43A047)] lg:px-7 lg:py-[22px] lg:grid-cols-4">
      {CELLS.map((c) => (
        <div key={c.label}>
          <div className="text-[10px] opacity-70 uppercase tracking-[0.8px] mb-1.5">
            {c.label}
          </div>
          <div className="text-[28px] font-bold">{c.value}</div>
          <div className="text-[11px] opacity-70 mt-0.5">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
