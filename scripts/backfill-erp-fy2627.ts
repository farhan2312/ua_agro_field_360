/**
 * One-time ERP backfill for FY 26-27 (Apr 2026 → today), month by month, from the live ERP feed.
 * Replaces each month's REAL sales with the ERP's authoritative per-line data (accurate TaxableValue),
 * then runs a single full segment recompute. Idempotent (importErpRows replaces by date window).
 *
 *   set -a && . webapp/.env && set +a && npx tsx scripts/backfill-erp-fy2627.ts
 *   START=2026-08-01 END=2026-08-31 npx tsx scripts/backfill-erp-fy2627.ts   # a custom range
 */
import "dotenv/config";
import { fetchErpSales, importErpRows } from "../lib/erp-sales";
import { recomputeSegments } from "../lib/segment-engine";
import { prisma } from "../lib/prisma";

const IST = 330 * 60_000;
const todayIST = () => new Date(Date.now() + IST).toISOString().slice(0, 10);

function monthWindows(startYmd: string, endYmd: string): [string, string][] {
  const [sy, sm] = startYmd.split("-").map(Number);
  const wins: [string, string][] = [];
  let y = sy, m = sm;
  for (;;) {
    const from = `${y}-${String(m).padStart(2, "0")}-01`;
    if (from > endYmd) break;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    let to = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    if (to > endYmd) to = endYmd;
    wins.push([from, to]);
    m++; if (m > 12) { m = 1; y++; }
  }
  return wins;
}

async function main() {
  const start = process.env.START || "2026-04-01";
  const end = process.env.END || todayIST();
  const wins = monthWindows(start, end);
  console.log(`ERP backfill ${start} → ${end}  (${wins.length} month windows)\n`);

  // Log the whole backfill as a single ErpSyncRun so it appears in the Sales Sync run log.
  const t0all = Date.now();
  const run = await prisma.erpSyncRun.create({ data: { fromDate: start, toDate: end, status: "RUNNING", triggeredBy: `backfill:${process.env.SYNC_BY || "CLI"}` } });

  let totalRows = 0, totalBills = 0, totalLines = 0, totalNew = 0, totalSkipped = 0, maxStores = 0;
  const affected = new Set<number>();
  try {
    for (const [from, to] of wins) {
      const t0 = Date.now();
      process.stdout.write(`  ${from} → ${to} … fetching`);
      const rows = await fetchErpSales(from, to);
      process.stdout.write(` ${rows.length} rows … importing`);
      const r = await importErpRows(rows, from, to);
      r.affectedFarmerIds.forEach((id) => affected.add(id));
      totalRows += r.rows; totalBills += r.bills; totalLines += r.linesInserted; totalNew += r.newCustomers; totalSkipped += r.skipped; maxStores = Math.max(maxStores, r.stores);
      console.log(`  →  bills=${r.bills} lines=${r.linesInserted} newCust=${r.newCustomers} skipped=${r.skipped} stores=${r.stores}  (${Date.now() - t0}ms)`);
    }
    await prisma.erpSyncRun.update({ where: { id: run.id }, data: { status: "SUCCESS", rows: totalRows, bills: totalBills, linesInserted: totalLines, newCustomers: totalNew, skipped: totalSkipped, stores: maxStores, durationMs: Date.now() - t0all } });
  } catch (e) {
    await prisma.erpSyncRun.update({ where: { id: run.id }, data: { status: "FAILED", error: (e instanceof Error ? e.message : String(e)).slice(0, 500), durationMs: Date.now() - t0all } }).catch(() => {});
    throw e;
  }

  console.log(`\nTOTAL: rows=${totalRows} bills=${totalBills} lines=${totalLines} newCustomers=${totalNew} skipped=${totalSkipped} affectedFarmers=${affected.size}`);
  console.log("Recomputing segments (full)…");
  const seg = await recomputeSegments({ onProgress: (m) => process.stdout.write(m) });
  console.log(`\nSegments: value=${JSON.stringify(seg.value)} lifecycle=${JSON.stringify(seg.lifecycle)} leads=${seg.leads} converted=${seg.converted}`);
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
