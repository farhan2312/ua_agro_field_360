import { prisma } from "@/lib/prisma";
import { grouped } from "@/lib/format";
import { MasterDataCard, type RegistryRow } from "@/components/settings/MasterDataCard";
import {
  SystemConfigCard,
  type ConfigState,
} from "@/components/settings/SystemConfigCard";
import { DataManagementCard } from "@/components/settings/DataManagementCard";

export const dynamic = "force-dynamic";

type Counts = {
  crops: number;
  villages: number;
  districts: number;
  products: number;
  stores: number;
  problemTypes: number;
  fieldOptions: number;
};

type LoadResult = {
  counts: Counts;
  config: ConfigState;
  districtOptions: string[];
};

const EMPTY: LoadResult = {
  counts: { crops: 0, villages: 0, districts: 0, products: 0, stores: 0, problemTypes: 0, fieldOptions: 0 },
  config: {
    primaryIdLabel: "Mobile Number",
    visitReasonRequired: true,
    requireGPS: true,
    defaultDistrict: "Agra",
  },
  districtOptions: ["Agra"],
};

async function load(): Promise<LoadResult> {
  try {
    const [
      cropOpt,
      villageOpt,
      productOpt,
      problemOpt,
      fieldOptionCount,
      storeCount,
      districtRows,
      settingRows,
    ] = await Promise.all([
      prisma.fieldOption.findUnique({ where: { fieldName: "Crop" } }),
      prisma.fieldOption.findUnique({ where: { fieldName: "Village" } }),
      prisma.fieldOption.findUnique({ where: { fieldName: "Product" } }),
      prisma.fieldOption.findUnique({ where: { fieldName: "Problem" } }),
      prisma.fieldOption.count(),
      prisma.store.count(),
      prisma.store.findMany({
        where: { zone: { not: null } },
        distinct: ["zone"],
        select: { zone: true },
        orderBy: { zone: "asc" },
      }),
      prisma.setting.findMany({
        where: {
          key: {
            in: [
              "config.primaryIdLabel",
              "config.visitReasonRequired",
              "config.requireGPS",
              "config.defaultDistrict",
            ],
          },
        },
      }),
    ]);

    const districts = districtRows
      .map((r) => r.zone)
      .filter((z): z is string => Boolean(z));

    const settingMap = new Map(settingRows.map((s) => [s.key, s.value]));
    const get = (k: string, fallback: string) => settingMap.get(k) ?? fallback;

    return {
      counts: {
        crops: cropOpt?.options.length ?? 0,
        villages: villageOpt?.options.length ?? 0,
        districts: districts.length,
        products: productOpt?.options.length ?? 0,
        stores: storeCount,
        problemTypes: problemOpt?.options.length ?? 0,
        fieldOptions: fieldOptionCount,
      },
      config: {
        primaryIdLabel: get("config.primaryIdLabel", EMPTY.config.primaryIdLabel),
        visitReasonRequired: get("config.visitReasonRequired", "true") === "true",
        requireGPS: get("config.requireGPS", "true") === "true",
        defaultDistrict: get("config.defaultDistrict", EMPTY.config.defaultDistrict),
      },
      districtOptions: districts.length ? districts : EMPTY.districtOptions,
    };
  } catch {
    return EMPTY;
  }
}

export default async function SettingsPage() {
  const { counts, config, districtOptions } = await load();

  const registry: RegistryRow[] = [
    {
      label: "Crop Master",
      caption: `${grouped(counts.crops)} crops configured`,
      href: "/master-data",
    },
    {
      label: "Village Directory",
      caption: `${grouped(counts.villages)} villages across ${counts.districts} districts`,
      href: "/master-data",
    },
    {
      label: "Product Catalog",
      caption: `${grouped(counts.products)} products configured`,
      href: "/master-data",
    },
    {
      label: "Store Locations",
      caption: `${grouped(counts.stores)} stores configured`,
      href: "/master-data",
    },
    {
      label: "Problem Categories",
      caption: `${grouped(counts.problemTypes)} problem types · ${grouped(counts.fieldOptions)} field options`,
      href: "/master-data",
    },
  ];

  return (
    <div className="animate-fadeUp">
      <div className="grid grid-cols-1 gap-[18px] md:grid-cols-2">
        <MasterDataCard rows={registry} />
        <div className="flex flex-col gap-[18px]">
          <SystemConfigCard initial={config} districtOptions={districtOptions} />
          <DataManagementCard />
        </div>
      </div>
    </div>
  );
}
