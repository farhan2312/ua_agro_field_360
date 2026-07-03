import { prisma } from "@/lib/prisma";
import { getRole } from "@/lib/session";
import { initials } from "@/lib/format";
import { storeColor } from "@/lib/store-utils";
import { PRISMA_TO_KEY, roleLabel, type RoleKey } from "@/lib/roles";
import { UserManagementScreen } from "@/components/users/UserManagementScreen";
import { PendingApprovals, type PendingUser } from "@/components/users/PendingApprovals";
import type { UserRow, StoreRow } from "@/components/users/types";

export const dynamic = "force-dynamic";

/** Store accent colours, keyed by code, matching the original design. */
const STORE_COLOR_BY_CODE: Record<string, string> = {
  AGRO0012: "#1565C0", // Ram Nagar
  AGRO0015: "#2E7D32", // Haidergarh
  AGRO0018: "#E65100", // Tiloi
  AGRO0019: "#7B1FA2", // Shivgarh
  AGRO0028: "#F57F17", // Sanda Farm
  AGRO0031: "#C62828", // Aliganj
};

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

async function loadData(): Promise<{
  users: UserRow[];
  stores: StoreRow[];
  totals: { stores: number; farmersMapped: number; officers: number };
}> {
  try {
    const [dbUsers, dbStores] = await Promise.all([
      prisma.user.findMany({
        where: { approvalStatus: "APPROVED" },
        orderBy: { id: "asc" },
      }),
      prisma.store.findMany({
        // Only the curated demo stores carry the rich master-data view.
        where: { source: "REAL", code: { in: Object.keys(STORE_COLOR_BY_CODE) } },
        orderBy: { id: "asc" },
        include: {
          employees: { orderBy: { id: "asc" }, select: { name: true } },
          farmers: {
            where: { source: "DEMO" },
            orderBy: { id: "asc" },
            select: { name: true },
          },
        },
      }),
    ]);

    const users: UserRow[] = dbUsers.map((u) => ({
      id: u.id,
      init: u.initials ?? initials(u.name),
      name: u.name,
      email: u.employeeCode ?? u.email ?? "",
      roleLabel: u.roleLabel ?? "",
      grad: `linear-gradient(135deg, ${u.gradA ?? "#2E7D32"}, ${u.gradB ?? "#66BB6A"})`,
      territory: u.territory ?? "",
      lastActive: u.lastActive ?? "",
      visitsMtd: u.visitsMtd ?? "—",
      status: u.active ? "Active" : "Inactive",
    }));

    const stores: StoreRow[] = dbStores.map((s) => ({
      id: s.id,
      name: s.name,
      color: STORE_COLOR_BY_CODE[s.code] ?? storeColor(s.id),
      address: s.address ?? "",
      district: s.zone ?? "",
      ao1: s.employees[0]?.name ?? "",
      ao2: s.employees[1]?.name ?? "",
      farmerCount: s.farmers.length,
      farmerNames: s.farmers.map((f) => f.name).join(", "),
    }));

    const officerNames = new Set<string>();
    stores.forEach((s) => {
      if (s.ao1) officerNames.add(s.ao1);
      if (s.ao2) officerNames.add(s.ao2);
    });

    return {
      users,
      stores,
      totals: {
        stores: stores.length,
        farmersMapped: stores.reduce((n, s) => n + s.farmerCount, 0),
        officers: officerNames.size,
      },
    };
  } catch {
    return {
      users: [],
      stores: [],
      totals: { stores: 0, farmersMapped: 0, officers: 0 },
    };
  }
}

export default async function UsersPage() {
  const role = await getRole();
  const canEdit = role === "sysadmin";
  const [{ users, stores, totals }, pending] = await Promise.all([
    loadData(),
    canEdit ? loadPending() : Promise.resolve([]),
  ]);

  return (
    <>
      {canEdit && <PendingApprovals pending={pending} />}
      <UserManagementScreen
        users={users}
        stores={stores}
        storeTotals={totals}
        canEdit={canEdit}
      />
    </>
  );
}
