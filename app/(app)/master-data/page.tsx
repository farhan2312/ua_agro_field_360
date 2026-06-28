import { prisma } from "@/lib/prisma";
import { getRole } from "@/lib/session";
import { EmptyState } from "@/components/ui";
import { shortStoreName, storeColor } from "@/lib/store-utils";
import { SEGMENT_ENUM_TO_LABEL } from "@/lib/segments";
import { empBadge } from "@/lib/status";
import { MasterDataView } from "@/components/master-data/MasterDataView";
import type {
  StoreRow,
  FarmerRow,
  EmployeeRow,
  MasterDataTab,
} from "@/components/master-data/types";

const FARMERS_PER_PAGE = 50;

type StoreWithEmployees = {
  id: number;
  code: string;
  name: string;
  status: string;
  zone: string | null;
  address: string | null;
  employees: {
    id: number;
    name: string;
    mobile: string | null;
    email: string | null;
    designation: string | null;
    post: string | null;
  }[];
};

function isBdm(designation: string | null, post: string | null): boolean {
  const d = (designation || "").toUpperCase();
  const p = (post || "").toUpperCase();
  return d.startsWith("UA") || d.includes("BDM") || p.includes("REGIONAL");
}

export default async function MasterDataPage({
  searchParams,
}: {
  searchParams?: { tab?: string; page?: string };
}) {
  const role = getRole();
  if (role !== "central" && role !== "sysadmin") {
    return (
      <EmptyState
        title="Restricted"
        hint="Master Data is available to Central HQ and System Admin only."
      />
    );
  }

  const initialTab: MasterDataTab =
    searchParams?.tab === "farmers"
      ? "farmers"
      : searchParams?.tab === "employees"
        ? "employees"
        : "stores";
  const page = Math.max(1, Number(searchParams?.page) || 1);
  const canEdit = role === "sysadmin";

  let stores: StoreRow[] = [];
  let farmers: FarmerRow[] = [];
  let employees: EmployeeRow[] = [];
  let farmerTotal = 0;

  try {
    const [storeRecords, farmerRecords, employeeRecords, farmerCount] =
      await Promise.all([
        prisma.store.findMany({
          orderBy: { code: "asc" },
          select: {
            id: true,
            code: true,
            name: true,
            status: true,
            zone: true,
            address: true,
            employees: {
              orderBy: { id: "asc" },
              select: {
                id: true,
                name: true,
                mobile: true,
                email: true,
                designation: true,
                post: true,
              },
            },
          },
        }),
        prisma.farmer.findMany({
          orderBy: { id: "asc" },
          skip: (page - 1) * FARMERS_PER_PAGE,
          take: FARMERS_PER_PAGE,
          select: {
            id: true,
            code: true,
            name: true,
            mobile: true,
            village: true,
            district: true,
            crop: true,
            segment: true,
            storeCode: true,
          },
        }),
        prisma.employee.findMany({
          orderBy: [{ storeCode: "asc" }, { id: "asc" }],
          select: {
            id: true,
            name: true,
            mobile: true,
            email: true,
            designation: true,
            post: true,
            storeCode: true,
            store: { select: { id: true, name: true } },
          },
        }),
        prisma.farmer.count(),
      ]);

    farmerTotal = farmerCount;

    // farmer-count per store code (small set of demo stores → one grouped query)
    const farmerCountsRaw = await prisma.farmer.groupBy({
      by: ["storeCode"],
      _count: { _all: true },
    });
    const farmerCountByCode = new Map<string, number>();
    for (const g of farmerCountsRaw) {
      if (g.storeCode) farmerCountByCode.set(g.storeCode, g._count._all);
    }

    // ── Stores → rows ──
    stores = (storeRecords as StoreWithEmployees[]).map((st) => {
      const officers = st.employees.filter(
        (e) => !isBdm(e.designation, e.post),
      );
      const bdm = st.employees.find((e) => isBdm(e.designation, e.post));
      const ao1 = officers[0];
      const ao2 = officers[1];
      return {
        id: st.id,
        code: st.code,
        name: st.name,
        address: st.address ?? "",
        zone: st.zone ?? "",
        district: st.zone ?? "",
        color: storeColor(st.id),
        status: st.status || "Active",
        ao1Name: ao1?.name ?? "—",
        ao1Mobile: ao1?.mobile ?? "",
        ao2Name: ao2?.name ?? "",
        ao2Mobile: ao2?.mobile ?? "",
        bdmName: bdm?.name ?? "—",
        bdmMobile: bdm?.mobile ?? "",
        farmerCountLabel: (
          farmerCountByCode.get(st.code) ?? 0
        ).toLocaleString("en-IN"),
      };
    });

    // store lookup (by code) for the farmers table joins
    const storeByCode = new Map<
      string,
      { color: string; shortName: string; aoName: string }
    >();
    for (const st of storeRecords as StoreWithEmployees[]) {
      const officer = st.employees.find((e) => !isBdm(e.designation, e.post));
      storeByCode.set(st.code, {
        color: storeColor(st.id),
        shortName: shortStoreName(st.name),
        aoName: officer?.name ?? "—",
      });
    }

    // ── Farmers → rows ──
    farmers = farmerRecords.map((f, i) => {
      const st = f.storeCode ? storeByCode.get(f.storeCode) : undefined;
      return {
        id: f.id,
        idx: (page - 1) * FARMERS_PER_PAGE + i + 1,
        code: f.code,
        name: f.name,
        district: f.district ?? "",
        mobile: f.mobile ?? "",
        village: f.village ?? "",
        crop: f.crop ?? "",
        storeName: st?.shortName ?? "—",
        storeColor: st?.color ?? "#9E9E9E",
        aoName: st?.aoName ?? "—",
        segment: f.segment ? SEGMENT_ENUM_TO_LABEL[f.segment] ?? "" : "",
      };
    });

    // store color by code for the employee STORE CODE badge
    const colorByCode = new Map<string, string>();
    for (const st of storeRecords as StoreWithEmployees[]) {
      colorByCode.set(st.code, storeColor(st.id));
    }

    // ── Employees → rows ──
    employees = employeeRecords.map((e, i) => {
      const badge = empBadge(e.designation);
      const post =
        e.post && e.post.trim()
          ? e.post.trim()
          : isBdm(e.designation, e.post)
            ? "BDM / Regional Manager"
            : "Staff";
      const code = e.storeCode ?? "";
      return {
        id: e.id,
        idx: i + 1,
        name: e.name,
        email: e.email ?? "",
        role: post,
        roleBg: badge.bg,
        roleColor: badge.c,
        mobile: e.mobile ?? "",
        storeCode: code,
        storeColor: code ? colorByCode.get(code) ?? "#9E9E9E" : "#9E9E9E",
        storeName: e.store ? shortStoreName(e.store.name) : "—",
      };
    });
  } catch {
    stores = [];
    farmers = [];
    employees = [];
    farmerTotal = 0;
  }

  const farmerPageCount = Math.max(
    1,
    Math.ceil(farmerTotal / FARMERS_PER_PAGE),
  );

  return (
    <MasterDataView
      stores={stores}
      farmers={farmers}
      employees={employees}
      initialTab={initialTab}
      farmerPage={page}
      farmerPageCount={farmerPageCount}
      canEdit={canEdit}
    />
  );
}
