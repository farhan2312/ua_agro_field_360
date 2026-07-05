import { prisma } from "@/lib/prisma";
import { getRole } from "@/lib/session";
import { initials } from "@/lib/format";
import { shortStoreName, storeColor } from "@/lib/store-utils";
import { PRISMA_TO_KEY, roleLabel, type RoleKey } from "@/lib/roles";
import { UserManagementScreen } from "@/components/users/UserManagementScreen";
import { PendingApprovals, type PendingUser } from "@/components/users/PendingApprovals";
import type {
  UserRow,
  OfficerLite,
  StoreMgmtRow,
  StoreMgmtData,
} from "@/components/users/types";

export const dynamic = "force-dynamic";

/** A store counts as operational (should have an officer) only when Active. */
const isActive = (status: string) => status.trim().toLowerCase() === "active";

async function loadPending(): Promise<PendingUser[]> {
  try {
    const rows = await prisma.user.findMany({
      where: { approvalStatus: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((u) => {
      const key = (PRISMA_TO_KEY[u.role] ?? "officer") as RoleKey;
      return {
        id: u.id,
        name: u.name,
        code: u.employeeCode ?? "",
        requestedRoleKey: key,
        requestedRoleLabel: u.roleLabel ?? roleLabel(key),
        when: u.lastActive ?? "recently",
      };
    });
  } catch {
    return [];
  }
}

async function loadUsers(): Promise<UserRow[]> {
  try {
    const dbUsers = await prisma.user.findMany({
      where: { approvalStatus: "APPROVED" },
      orderBy: { id: "asc" },
    });
    return dbUsers.map((u) => ({
      id: u.id,
      init: u.initials ?? initials(u.name),
      name: u.name,
      email: u.employeeCode ?? u.email ?? "",
      employeeCode: u.employeeCode ?? "",
      mobile: u.mobile ?? "",
      workEmail: u.workEmail ?? "",
      roleLabel: u.roleLabel ?? "",
      roleKey: PRISMA_TO_KEY[u.role] ?? "officer",
      grad: `linear-gradient(135deg, ${u.gradA ?? "#2E7D32"}, ${u.gradB ?? "#66BB6A"})`,
      territory: u.territory ?? "",
      lastActive: u.lastActive ?? "",
      visitsMtd: u.visitsMtd ?? "—",
      status: u.active ? "Active" : "Inactive",
    }));
  } catch {
    return [];
  }
}

const EMPTY_STORE_ADMIN: StoreMgmtData = {
  rows: [],
  allOfficers: [],
  unassignedOfficers: [],
  regionals: [],
  totals: {
    total: 0, active: 0, mapped: 0, unmapped: 0, closed: 0,
    officersAssigned: 0, officersUnassigned: 0, farmersMapped: 0,
  },
};

async function loadStoreMgmt(): Promise<StoreMgmtData> {
  try {
    const [stores, asr, regional, groups] = await Promise.all([
      prisma.store.findMany({
        orderBy: [{ status: "asc" }, { name: "asc" }],
        select: {
          id: true, code: true, name: true, status: true, zone: true,
          address: true, regionalManager: true, lat: true, lng: true,
        },
      }),
      prisma.user.findMany({
        where: { role: "ASR", approvalStatus: "APPROVED" },
        orderBy: { name: "asc" },
        select: {
          id: true, name: true, employeeCode: true, storeId: true,
          zone: true, active: true, initials: true, gradA: true, gradB: true,
        },
      }),
      prisma.user.findMany({
        where: { role: "REGIONAL", approvalStatus: "APPROVED" },
        orderBy: { name: "asc" },
        select: { id: true, name: true, zone: true },
      }),
      prisma.farmer.groupBy({ by: ["storeId"], _count: { _all: true } }),
    ]);

    const farmerByStore = new Map<number, number>();
    let farmersMapped = 0;
    for (const g of groups) {
      if (g.storeId != null) {
        farmerByStore.set(g.storeId, g._count._all);
        farmersMapped += g._count._all;
      }
    }
    const validStoreIds = new Set(stores.map((s) => s.id));

    const toOfficer = (u: (typeof asr)[number]): OfficerLite => ({
      id: u.id,
      name: u.name,
      code: u.employeeCode ?? "",
      init: u.initials ?? initials(u.name),
      grad: `linear-gradient(135deg, ${u.gradA ?? "#1565C0"}, ${u.gradB ?? "#42A5F5"})`,
      active: u.active,
      zone: u.zone ?? "",
      storeId: u.storeId,
    });
    const allOfficers = asr.map(toOfficer);
    const officersByStore = new Map<number, OfficerLite[]>();
    const unassignedOfficers: OfficerLite[] = [];
    for (const o of allOfficers) {
      if (o.storeId != null && validStoreIds.has(o.storeId)) {
        const arr = officersByStore.get(o.storeId);
        if (arr) arr.push(o);
        else officersByStore.set(o.storeId, [o]);
      } else {
        unassignedOfficers.push(o); // unassigned or dangling (points at a deleted store)
      }
    }

    const rows: StoreMgmtRow[] = stores.map((s) => {
      const officers = officersByStore.get(s.id) ?? [];
      return {
        id: s.id,
        code: s.code,
        name: s.name,
        shortName: shortStoreName(s.name),
        status: s.status,
        zone: s.zone ?? "",
        address: s.address ?? "",
        regionalManager: s.regionalManager ?? "",
        lat: s.lat,
        lng: s.lng,
        hasGps: s.lat != null && s.lng != null,
        color: storeColor(s.id),
        farmerCount: farmerByStore.get(s.id) ?? 0,
        officers,
        unmapped: isActive(s.status) && !officers.some((o) => o.active),
      };
    });

    const activeCount = stores.filter((s) => isActive(s.status)).length;
    const officersAssigned = allOfficers.filter(
      (o) => o.storeId != null && validStoreIds.has(o.storeId),
    ).length;

    return {
      rows,
      allOfficers,
      unassignedOfficers,
      regionals: regional.map((r) => ({ id: r.id, name: r.name, zone: r.zone ?? "" })),
      totals: {
        total: stores.length,
        active: activeCount,
        mapped: rows.filter((r) => !r.unmapped && isActive(r.status)).length,
        unmapped: rows.filter((r) => r.unmapped).length,
        closed: stores.length - activeCount,
        officersAssigned,
        officersUnassigned: unassignedOfficers.length,
        farmersMapped,
      },
    };
  } catch {
    return EMPTY_STORE_ADMIN;
  }
}

export default async function UsersPage() {
  const role = await getRole();
  const canEdit = role === "sysadmin";
  const [users, storeAdmin, pending] = await Promise.all([
    loadUsers(),
    loadStoreMgmt(),
    canEdit ? loadPending() : Promise.resolve([]),
  ]);

  return (
    <>
      {canEdit && <PendingApprovals pending={pending} />}
      <UserManagementScreen users={users} storeAdmin={storeAdmin} canEdit={canEdit} />
    </>
  );
}
