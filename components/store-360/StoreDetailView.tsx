import Link from "next/link";
import type { StoreDetail } from "@/app/actions/store-360";

const CARD = "rounded-[14px] border border-black/[0.03] bg-white p-[22px] shadow-[0_1px_3px_rgba(0,0,0,0.04)]";
const n = (x: number) => x.toLocaleString("en-IN");
const inr = (x: number) => (x >= 1e7 ? `₹${(x / 1e7).toFixed(2)} Cr` : x >= 1e5 ? `₹${(x / 1e5).toFixed(1)} L` : `₹${n(Math.round(x))}`);
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—");
const rel = (iso: string | null) => { if (!iso) return "never"; const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000); return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 30 ? `${d}d ago` : d < 365 ? `${Math.floor(d / 30)}mo ago` : `${Math.floor(d / 365)}y ago`; };

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`${CARD}`}>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.4px] text-[#9E9E9E]">{label}</div>
      <div className="mt-1 text-[22px] font-bold leading-none tabular-nums" style={{ color: tone ?? "#1A1C1A" }}>{value}</div>
    </div>
  );
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 text-[14px] font-bold text-[#1A1C1A]">{children}</div>;
}
function SegBars({ rows }: { rows: { label: string; count: number; color: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!rows.length) return <div className="text-[12px] text-[#9E9E9E]">No segment data.</div>;
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-[12px]">
          <span className="w-[96px] shrink-0 truncate" style={{ color: r.color }}>{r.label}</span>
          <div className="relative h-[16px] flex-1 overflow-hidden rounded-[5px] bg-[#F3F5F3]">
            <div className="h-full rounded-[5px]" style={{ width: `${Math.max(3, (r.count / max) * 100)}%`, background: r.color }} />
          </div>
          <span className="w-10 shrink-0 text-right font-semibold tabular-nums text-[#1A1C1A]">{n(r.count)}</span>
        </div>
      ))}
    </div>
  );
}
function MoneyBars({ rows }: { rows: { label: string; amount: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.amount));
  if (!rows.length) return <div className="text-[12px] text-[#9E9E9E]">No data.</div>;
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-[12px]">
          <span className="w-[120px] shrink-0 truncate text-[#616161]" title={r.label}>{r.label}</span>
          <div className="relative h-[16px] flex-1 overflow-hidden rounded-[5px] bg-[#F1F8F1]">
            <div className="h-full rounded-[5px] bg-[#2E7D32]" style={{ width: `${Math.max(3, (r.amount / max) * 100)}%` }} />
          </div>
          <span className="w-16 shrink-0 text-right font-semibold tabular-nums text-[#1A1C1A]">{inr(r.amount)}</span>
        </div>
      ))}
    </div>
  );
}

export function StoreDetailView({ store }: { store: StoreDetail }) {
  const k = store.kpis;
  const trendMax = Math.max(1, ...store.sales.monthly.map((m) => m.amount));
  const bw = 16, gap = 5, h = 120;

  return (
    <div className="animate-fadeUp">
      <Link href="/stores" className="mb-3 inline-block text-[12.5px] font-semibold text-[#2E7D32] hover:underline">← All stores</Link>

      {/* Header */}
      <div className={`${CARD} mb-[18px]`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[20px] font-extrabold text-[#1A1C1A]">{store.name}</div>
            <div className="mt-1 text-[12.5px] text-[#616161]">{store.code}{store.zone ? ` · ${store.zone}` : ""}{store.address ? ` · ${store.address}` : ""}</div>
            {store.regionalManager && <div className="mt-0.5 text-[11.5px] text-[#9E9E9E]">Regional Manager: <b className="text-[#616161]">{store.regionalManager}</b></div>}
          </div>
          <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={store.status === "Active" ? { background: "#E8F5E9", color: "#2E7D32" } : { background: "#F5F5F5", color: "#9E9E9E" }}>{store.status}</span>
        </div>
      </div>

      {/* KPI row */}
      <div className="mb-[18px] grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Farmers" value={n(k.farmers)} tone="#2E7D32" />
        <Kpi label="Sales LTV (base)" value={inr(k.ltv)} tone="#1565C0" />
        <Kpi label="Active campaigns" value={n(k.activeCampaigns)} tone="#6A1B9A" />
        <Kpi label="Overdue follow-ups" value={n(k.overdueActions)} tone={k.overdueActions > 0 ? "#C62828" : "#1A1C1A"} />
        <Kpi label="Officers" value={n(k.officers)} />
        <Kpi label="Open follow-ups" value={n(k.openActions)} tone={k.openActions > 0 ? "#E65100" : "#1A1C1A"} />
        <Kpi label="Visits" value={n(k.visits)} />
        <Kpi label="Ghoshti meetups" value={n(k.ghoshti)} />
      </div>

      {/* Officers + Farmer segments */}
      <div className="mb-[18px] grid grid-cols-1 gap-[18px] lg:grid-cols-2">
        <div className={CARD}>
          <SectionTitle>Officers &amp; team ({store.officers.length})</SectionTitle>
          {store.officers.length === 0 ? <div className="text-[12.5px] text-[#9E9E9E]">No officers mapped to this store.</div> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-left text-[12.5px]">
              <thead><tr className="border-b border-[#EEE] text-[10px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]"><th className="py-2">Name</th><th>Role</th><th className="text-right">Visits</th><th>Last active</th></tr></thead>
              <tbody>{store.officers.map((o) => (
                <tr key={o.code ?? o.name} className="border-b border-[#F5F5F5] last:border-0">
                  <td className="py-2 font-semibold text-[#1A1C1A]">{o.name}<div className="text-[10px] font-normal text-[#9E9E9E]">{o.code ?? "—"}</div></td>
                  <td className="text-[#616161]">{o.role}</td>
                  <td className="text-right tabular-nums text-[#616161]">{n(o.visits)}</td>
                  <td className="text-[#616161]">{rel(o.lastActive)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
        <div className={CARD}>
          <SectionTitle>Farmers by segment</SectionTitle>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><div className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]">Value tier</div><SegBars rows={store.valueSeg} /></div>
            <div><div className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]">Lifecycle</div><SegBars rows={store.lifecycleSeg} /></div>
          </div>
          <div className="mt-4 mb-2 flex items-center justify-between">
            <div className="text-[10.5px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]">Top farmers by LTV</div>
            <Link href={`/farmers?store=${store.code}`} className="text-[11px] font-semibold text-[#2E7D32] hover:underline">All in Farmer 360 →</Link>
          </div>
          <div className="flex flex-col gap-1">
            {store.topFarmers.length === 0 ? <div className="text-[12px] text-[#9E9E9E]">No farmers.</div> : store.topFarmers.map((f) => (
              <Link key={f.id} href={`/farmers/${f.id}`} className="flex items-center justify-between rounded-[8px] px-2 py-1.5 text-[12px] hover:bg-[#F5FFF5]">
                <span className="min-w-0 truncate"><span className="font-semibold text-[#1565C0]">{f.name}</span> <span className="text-[#9E9E9E]">· {f.lifecycle}</span></span>
                <span className="shrink-0 font-semibold tabular-nums text-[#1A1C1A]">{inr(f.ltv)}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Sales */}
      <div className={`${CARD} mb-[18px]`}>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[14px] font-bold text-[#1A1C1A]">Sales</div>
          <div className="text-[12px] text-[#9E9E9E]">LTV (base): <b className="text-[#1565C0]">{inr(store.sales.ltv)}</b></div>
        </div>
        {store.sales.monthly.length === 0 ? <div className="text-[12.5px] text-[#9E9E9E]">No sales recorded for this store.</div> : (
          <>
            <div className="mb-4 overflow-x-auto">
              <svg width={Math.max(store.sales.monthly.length * (bw + gap), 200)} height={h + 24} className="block">
                {store.sales.monthly.map((m, i) => { const bh = (m.amount / trendMax) * h; const x = i * (bw + gap); const lbl = i % 3 === 0 || i === store.sales.monthly.length - 1; return (
                  <g key={m.ym}>
                    <rect x={x} y={h - bh + 4} width={bw} height={bh} rx={2} fill="#2E7D32"><title>{`${m.label}: ${inr(m.amount)}`}</title></rect>
                    {lbl && <text x={x + bw / 2} y={h + 16} textAnchor="middle" className="fill-[#9E9E9E]" fontSize={8.5}>{m.label}</text>}
                  </g>
                ); })}
              </svg>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div><div className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]">Top crops (by base spend)</div><MoneyBars rows={store.sales.topCrops.map((c) => ({ label: c.crop, amount: c.amount }))} /></div>
              <div><div className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]">Top products</div><MoneyBars rows={store.sales.topProducts.map((p) => ({ label: p.name, amount: p.amount }))} /></div>
            </div>
          </>
        )}
      </div>

      {/* Campaigns + Actions */}
      <div className="mb-[18px] grid grid-cols-1 gap-[18px] lg:grid-cols-2">
        <div className={CARD}>
          <SectionTitle>Campaigns ({store.campaigns.length})</SectionTitle>
          {store.campaigns.length === 0 ? <div className="text-[12.5px] text-[#9E9E9E]">No campaigns have enrolled this store's farmers.</div> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-left text-[12.5px]">
              <thead><tr className="border-b border-[#EEE] text-[10px] font-bold uppercase tracking-[0.4px] text-[#9E9E9E]"><th className="py-2">Campaign</th><th>Status</th><th className="text-right">Farmers</th><th className="text-right">Reached</th><th className="text-right">Reach</th></tr></thead>
              <tbody>{store.campaigns.map((c) => (
                <tr key={c.id} className="border-b border-[#F5F5F5] last:border-0">
                  <td className="py-2 font-semibold text-[#1A1C1A]">{c.name}</td>
                  <td><span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={c.status === "ACTIVE" ? { background: "#E8F5E9", color: "#2E7D32" } : { background: "#F5F5F5", color: "#9E9E9E" }}>{c.status}</span></td>
                  <td className="text-right tabular-nums">{n(c.members)}</td>
                  <td className="text-right tabular-nums">{n(c.reached)}</td>
                  <td className="text-right font-semibold tabular-nums" style={{ color: c.reachPct >= 50 ? "#2E7D32" : c.reachPct > 0 ? "#E65100" : "#9E9E9E" }}>{c.reachPct}%</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
        <div className={CARD}>
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[14px] font-bold text-[#1A1C1A]">Action Registry</div>
            <Link href={`/action-registry?store=${store.code}`} className="text-[11px] font-semibold text-[#2E7D32] hover:underline">Open registry →</Link>
          </div>
          <div className="mb-3 flex gap-4 text-[12px]">
            <span>Open <b className="text-[#E65100]">{n(store.actions.open)}</b></span>
            <span>Overdue <b className="text-[#C62828]">{n(store.actions.overdue)}</b></span>
            <span>Done <b className="text-[#2E7D32]">{n(store.actions.done)}</b></span>
          </div>
          {store.actions.recent.length === 0 ? <div className="text-[12.5px] text-[#9E9E9E]">No follow-ups for this store.</div> : (
            <div className="flex flex-col gap-1">
              {store.actions.recent.map((a) => { const overdue = a.status === "OPEN" && a.due && new Date(a.due) < new Date(); return (
                <div key={a.id} className="flex items-center justify-between rounded-[8px] border-b border-[#F5F5F5] px-2 py-1.5 text-[12px] last:border-0">
                  <span className="min-w-0 truncate text-[#424242]">{a.reason}{a.farmer ? ` · ${a.farmer}` : ""}</span>
                  <span className="shrink-0 text-[11px]" style={{ color: a.status === "DONE" ? "#2E7D32" : overdue ? "#C62828" : "#616161" }}>{a.status === "DONE" ? "Done" : `${fmtDate(a.due)}${overdue ? " · overdue" : ""}`}</span>
                </div>
              ); })}
            </div>
          )}
        </div>
      </div>

      {/* Recent visits + Ghoshti */}
      <div className="mb-[18px] grid grid-cols-1 gap-[18px] lg:grid-cols-2">
        <div className={CARD}>
          <SectionTitle>Recent visits</SectionTitle>
          {store.recentVisits.length === 0 ? <div className="text-[12.5px] text-[#9E9E9E]">No visits recorded.</div> : (
            <div className="flex flex-col gap-1">{store.recentVisits.map((v) => (
              <Link key={v.id} href={`/visits/${v.id}`} className="flex items-center justify-between rounded-[8px] px-2 py-1.5 text-[12px] hover:bg-[#F5FFF5]">
                <span className="min-w-0 truncate"><span className="font-semibold text-[#1A1C1A]">{v.farmer}</span> <span className="text-[#9E9E9E]">· {v.type} · {v.officer}</span></span>
                <span className="shrink-0 text-[11px] text-[#9E9E9E]">{v.date || "—"}</span>
              </Link>
            ))}</div>
          )}
        </div>
        <div className={CARD}>
          <SectionTitle>Ghoshti meetups</SectionTitle>
          {store.ghoshtiList.length === 0 ? <div className="text-[12.5px] text-[#9E9E9E]">No meetups at this store.</div> : (
            <div className="flex flex-col gap-1">{store.ghoshtiList.map((g) => (
              <Link key={g.id} href={`/ghoshti/${g.id}`} className="flex items-center justify-between rounded-[8px] px-2 py-1.5 text-[12px] hover:bg-[#F5FFF5]">
                <span className="min-w-0 truncate"><span className="font-semibold text-[#1A1C1A]">{g.topic}</span> <span className="text-[#9E9E9E]">· {g.attendees} attendees</span></span>
                <span className="shrink-0 text-[11px]" style={{ color: g.status === "APPROVED" ? "#2E7D32" : g.status === "PENDING" ? "#E65100" : "#C62828" }}>{fmtDate(g.date)}</span>
              </Link>
            ))}</div>
          )}
        </div>
      </div>
    </div>
  );
}
