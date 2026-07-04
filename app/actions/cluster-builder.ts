"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getPersona } from "@/lib/session";
import {
  SEGMENT_LABEL_TO_ENUM,
  LEAD_LABEL_TO_ENUM,
  SEGMENT_ENUM_TO_LABEL,
  LEAD_ENUM_TO_LABEL,
} from "@/lib/segments";
import {
  PAGE_SIZE,
  MAX_CLUSTER,
  type FarmerFilters,
  type StoreFarmersResult,
  type CreateClusterInput,
  type CreateClusterResult,
} from "@/lib/cluster";

/** Build the Prisma `where` for the selected stores' farmers from the active filters. */
function buildWhere(storeIds: number[], f: FarmerFilters): Prisma.FarmerWhereInput {
  const where: Prisma.FarmerWhereInput =
    storeIds.length === 1 ? { storeId: storeIds[0] } : { storeId: { in: storeIds } };
  if (f.village) where.village = f.village;
  if (f.crop) where.crop = f.crop;
  if (f.segment && SEGMENT_LABEL_TO_ENUM[f.segment as never])
    where.segment = SEGMENT_LABEL_TO_ENUM[f.segment as never] as never;
  if (f.leadStatus && LEAD_LABEL_TO_ENUM[f.leadStatus as never])
    where.leadStatus = LEAD_LABEL_TO_ENUM[f.leadStatus as never] as never;
  if (f.category) where.sales = { some: { category: f.category } };
  if (f.q?.trim()) {
    const q = f.q.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { mobile: { contains: q } },
      { village: { contains: q, mode: "insensitive" } },
      { code: { contains: q, mode: "insensitive" } },
    ];
  }
  return where;
}

export async function getStoreFarmers(
  storeIds: number[],
  filters: FarmerFilters,
  page = 1,
): Promise<StoreFarmersResult> {
  if (!storeIds.length) {
    return { rows: [], total: 0, page, pageSize: PAGE_SIZE, villages: [], crops: [] };
  }
  try {
    const where = buildWhere(storeIds, filters);
    const storeScope: Prisma.FarmerWhereInput =
      storeIds.length === 1 ? { storeId: storeIds[0] } : { storeId: { in: storeIds } };
    const [total, rows, villageRows, cropRows] = await Promise.all([
      prisma.farmer.count({ where }),
      prisma.farmer.findMany({
        where,
        orderBy: { name: "asc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: { id: true, name: true, mobile: true, village: true, crop: true, segment: true, leadStatus: true },
      }),
      prisma.farmer.findMany({
        where: { ...storeScope, village: { not: null } },
        distinct: ["village"],
        select: { village: true },
        orderBy: { village: "asc" },
        take: 300,
      }),
      prisma.farmer.findMany({
        where: { ...storeScope, crop: { not: null } },
        distinct: ["crop"],
        select: { crop: true },
        orderBy: { crop: "asc" },
        take: 50,
      }),
    ]);

    // Lifetime value + bill count per farmer on this page.
    const ids = rows.map((r) => r.id);
    const sums = ids.length
      ? await prisma.sale.groupBy({
          by: ["farmerId"],
          where: { farmerId: { in: ids } },
          _sum: { amountNum: true },
          _count: { _all: true },
        })
      : [];
    const byId = new Map(sums.map((s) => [s.farmerId, { ltv: s._sum.amountNum ?? 0, bills: s._count._all }]));

    return {
      rows: rows.map((r) => ({
        id: r.id,
        name: r.name,
        mobile: r.mobile,
        village: r.village,
        crop: r.crop,
        segment: r.segment ? SEGMENT_ENUM_TO_LABEL[r.segment] ?? null : null,
        leadStatus: r.leadStatus ? LEAD_ENUM_TO_LABEL[r.leadStatus] ?? null : null,
        ltv: byId.get(r.id)?.ltv ?? 0,
        bills: byId.get(r.id)?.bills ?? 0,
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
      villages: villageRows.map((v) => v.village!).filter(Boolean),
      crops: cropRows.map((c) => c.crop!).filter(Boolean),
    };
  } catch {
    return { rows: [], total: 0, page, pageSize: PAGE_SIZE, villages: [], crops: [] };
  }
}

export async function createClusterFromSelection(
  input: CreateClusterInput,
): Promise<CreateClusterResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Give the cluster a name." };

  try {
    let ids: number[];
    if (input.allMatching) {
      const where = buildWhere(input.storeIds, input.filters);
      const matched = await prisma.farmer.findMany({
        where,
        select: { id: true },
        take: MAX_CLUSTER,
      });
      ids = matched.map((m) => m.id);
    } else {
      ids = (input.explicitIds ?? []).slice(0, MAX_CLUSTER);
    }
    if (ids.length === 0) return { ok: false, error: "No farmers selected." };

    // Store a display sample of names (full list can be thousands).
    const nameRows = await prisma.farmer.findMany({
      where: { id: { in: ids.slice(0, 100) } },
      select: { name: true },
    });

    const activeFilters = Object.entries(input.filters)
      .filter(([, v]) => v && String(v).trim())
      .map(([k, v]) => `${k}: ${v}`);

    const persona = await getPersona();
    const criteria = JSON.stringify({
      storeIds: input.storeIds,
      storeName: input.storeName,
      filters: input.filters,
      count: ids.length,
    });

    await prisma.cluster.create({
      data: {
        name,
        layerFilter: activeFilters[0] ?? "store",
        criteria,
        farmerIds: ids,
        farmerNames: nameRows.map((n) => n.name),
        createdBy: persona.name,
        source: "REAL",
      },
    });

    revalidatePath("/clusters");
    return { ok: true, count: ids.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to create cluster" };
  }
}
