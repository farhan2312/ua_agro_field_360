import { prisma } from "@/lib/prisma";
import { getRole } from "@/lib/session";
import { initials } from "@/lib/format";
import { storeColor } from "@/lib/store-utils";
import { UserManagementScreen } from "@/components/users/UserManagementScreen";
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

async function loadData(): Promise<{
  users: UserRow[];
  stores: StoreRow[];
  totals: { stores: number; farmersMapped: number; officers: number };
}> {
  try {
    const [dbUsers, dbStores] = await Promise.all([
      prisma.user.findMany({ orderBy: { id: "asc" } }),
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
      email: u.email ?? "",
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
  const role = getRole();
  const canEdit = role === "sysadmin";
  const { users, stores, totals } = await loadData();

  return (
    <UserManagementScreen
      users={users}
      stores={stores}
      storeTotals={totals}
      canEdit={canEdit}
    />
  );
}
