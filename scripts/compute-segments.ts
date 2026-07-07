/**
 * Compute CRM segmentation onto every farmer (monthly rolling job).
 *   npx tsx scripts/compute-segments.ts
 *   SEGMENT_ASOF=2026-03-31 npx tsx scripts/compute-segments.ts   (override the anchor)
 *
 * Derives, from Sale history, the rolling-window lifecycle + value tags, the single
 * exclusive campaign segment (by the comm-plan priority), the P12M spend + gap-to-HNI,
 * and seed-only crop tags (maize/potato) with the last seed purchase per crop.
 * Best-effort crop detection from the Sale item summary (see docs/crm-pilot-spec.md §7.1).
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const HNI_MIN = 12000;
const POTENTIAL_MIN = 10000;

const ASOF = process.env.SEGMENT_ASOF ? new Date(`${process.env.SEGMENT_ASOF}T23:59:59Z`) : new Date();
const minusM = (d: Date, n: number) => { const x = new Date(d); x.setMonth(x.getMonth() - n); return x; };
const P6 = minusM(ASOF, 6), P12 = minusM(ASOF, 12), P24 = minusM(ASOF, 24);

interface Agg {
  p6: boolean; p712: boolean; p1324: boolean;
  earliest: Date | null; spend12: number;
  maizeItem: string | null; maizeAt: Date | null;
  potatoItem: string | null; potatoAt: Date | null;
}

// ── SQL literal helpers (values cast per-row so VALUES column types are unambiguous) ──
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const txt = (s: string | null) => (s == null ? "NULL::text" : `${q(s)}::text`);
const txtArr = (a: string[]) => (a.length ? `ARRAY[${a.map(q).join(",")}]::text[]` : "ARRAY[]::text[]");
const int = (n: number | null) => (n == null ? "NULL::int" : `${Math.round(n)}::int`);
const ts = (d: Date | null) => (d == null ? "NULL::timestamptz" : `'${d.toISOString()}'::timestamptz`);

async function main() {
  console.log(`Anchor (ASOF) = ${ASOF.toISOString().slice(0, 10)}`);
  const agg = new Map<number, Agg>();
  const getA = (id: number): Agg => {
    let a = agg.get(id);
    if (!a) { a = { p6: false, p712: false, p1324: false, earliest: null, spend12: 0, maizeItem: null, maizeAt: null, potatoItem: null, potatoAt: null }; agg.set(id, a); }
    return a;
  };

  // ── Stream all dated sales → per-farmer aggregates ──
  let cursor = 0, processed = 0;
  const TAKE = 50000;
  for (;;) {
    const sales = await prisma.sale.findMany({
      where: { id: { gt: cursor }, soldAt: { not: null }, farmerId: { not: undefined } },
      orderBy: { id: "asc" }, take: TAKE,
      select: { id: true, farmerId: true, soldAt: true, amountNum: true, items: true, category: true },
    });
    if (!sales.length) break;
    for (const s of sales) {
      cursor = s.id;
      const dt = s.soldAt as Date;
      const a = getA(s.farmerId);
      if (!a.earliest || dt < a.earliest) a.earliest = dt;
      if (dt > P6) a.p6 = true;
      else if (dt > P12) a.p712 = true;
      else if (dt > P24) a.p1324 = true;
      if (dt > P12) a.spend12 += s.amountNum ?? 0;
      // Seed-only crop detection (best-effort from the bill's item summary).
      const it = (s.items ?? "").toUpperCase();
      const cat = (s.category ?? "").toUpperCase();
      if (cat.includes("SEED") || it.includes("SEED")) {
        if (/MAIZE|MAKKA/.test(it)) { if (!a.maizeAt || dt > a.maizeAt) { a.maizeAt = dt; a.maizeItem = s.items ?? null; } }
        if (/POTATO|ALOO/.test(it)) { if (!a.potatoAt || dt > a.potatoAt) { a.potatoAt = dt; a.potatoItem = s.items ?? null; } }
      }
      processed++;
    }
    process.stdout.write(`\r  sales scanned: ${processed}`);
    if (sales.length < TAKE) break;
  }
  process.stdout.write("\n");
  console.log(`  ${agg.size} farmers with dated sales`);

  // ── Compute + build bulk-update rows ──
  const segCounts: Record<string, number> = {};
  let maizeCount = 0, potatoCount = 0;
  const rows: string[] = [];
  for (const [id, a] of agg) {
    const regular = a.p6 && a.p712;
    const loyal = regular && a.p1324;
    const atRisk = a.p712 && !a.p6;
    const isNew = a.earliest != null && a.earliest > P12; // first-ever purchase within P12M
    const lapsed = !a.p6 && !a.p712; // has sales, none in P12M
    const hni = a.spend12 >= HNI_MIN;
    const potential = !hni && a.spend12 >= POTENTIAL_MIN;

    const tags: string[] = [];
    if (regular) tags.push("regular");
    if (loyal) tags.push("loyal");
    if (atRisk) tags.push("at_risk");
    if (lapsed) tags.push("lapsed");
    if (isNew) tags.push("new");
    if (hni) tags.push("hni");
    if (potential) tags.push("potential_hni");

    // Exclusive campaign segment by comm-plan priority.
    let seg = "OTHER";
    if (hni) seg = "HNI";
    else if (potential) seg = "POTENTIAL_HNI";
    else if (regular) seg = "REGULAR";
    else if (atRisk) seg = "AT_RISK";
    else if (isNew) seg = "NEW";
    else if (lapsed) seg = "LAPSED";
    segCounts[seg] = (segCounts[seg] ?? 0) + 1;

    const crops: string[] = [];
    if (a.maizeItem) { crops.push("maize"); maizeCount++; }
    if (a.potatoItem) { crops.push("potato"); potatoCount++; }

    const gap = potential ? HNI_MIN - a.spend12 : null;

    rows.push(
      `(${id}::int, ${txtArr(tags)}, ${q(seg)}::text, ${txtArr(crops)}, ${int(a.spend12)}, ${int(gap)}, ` +
      `${txt(a.maizeItem)}, ${ts(a.maizeAt)}, ${txt(a.potatoItem)}, ${ts(a.potatoAt)})`,
    );
  }

  // ── Bulk UPDATE ... FROM (VALUES ...) in chunks ──
  const CHUNK = 2000;
  let updated = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const sql =
      `UPDATE "Farmer" AS f SET ` +
      `"segmentTags"=v.tags, "campaignSegment"=v.seg, "cropTags"=v.crops, ` +
      `"p12mSpend"=v.spend, "hniGap"=v.gap, ` +
      `"lastMaizeItem"=v.mitem, "lastMaizeAt"=v.mat, "lastPotatoItem"=v.pitem, "lastPotatoAt"=v.pat, ` +
      `"segmentComputedAt"=now() ` +
      `FROM (VALUES ${slice.join(",")}) AS v(id, tags, seg, crops, spend, gap, mitem, mat, pitem, pat) ` +
      `WHERE f.id = v.id;`;
    updated += await prisma.$executeRawUnsafe(sql);
    process.stdout.write(`\r  farmers updated: ${updated}/${rows.length}`);
  }
  process.stdout.write("\n");

  console.log("Campaign segments:", JSON.stringify(segCounts));
  console.log(`Crop tags — maize: ${maizeCount}, potato: ${potatoCount}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
