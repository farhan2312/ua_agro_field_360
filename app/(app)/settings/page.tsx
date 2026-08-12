import { prisma } from "@/lib/prisma";
import { grouped } from "@/lib/format";
import { zapConfig } from "@/lib/zapsms";
import { waConfig } from "@/lib/whatsapp";
import { MasterDataCard, type RegistryRow } from "@/components/settings/MasterDataCard";
import {
  SystemConfigCard,
  type ConfigState,
} from "@/components/settings/SystemConfigCard";
import { DataManagementCard } from "@/components/settings/DataManagementCard";
import { SmsTestCard } from "@/components/settings/SmsTestCard";
import { WhatsAppOptInsCard } from "@/components/settings/WhatsAppOptInsCard";
import { listOptIns, getOptInQrConfig, type OptInRow } from "@/app/actions/whatsapp-optins";

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

  // Test-messaging bench data: gateway status + saved comm plans to optionally load a message from.
  const sms = zapConfig();
  const wa = waConfig();
  let plans: { id: number; name: string; template: string; dltTemplateId: string | null }[] = [];
  try {
    plans = await prisma.commTemplate.findMany({
      select: { id: true, name: true, template: true, dltTemplateId: true },
      orderBy: [{ priority: "asc" }, { name: "asc" }],
    });
  } catch {
    // DB unavailable — the test bench still renders with free text only.
  }

  let optIns: { total: number; rows: OptInRow[] } = { total: 0, rows: [] };
  let optInCfg = { number: "", message: "" };
  try {
    optIns = await listOptIns();
    const cfg = await getOptInQrConfig();
    optInCfg = { number: cfg.number, message: cfg.message };
  } catch { /* DB unavailable */ }

  const registry: RegistryRow[] = [
    {
      label: "Crop Master",
      caption: `${grouped(counts.crops)} crops configured`,
    },
    {
      label: "Village Directory",
      caption: `${grouped(counts.villages)} villages across ${counts.districts} districts`,
    },
    {
      label: "Product Catalog",
      caption: `${grouped(counts.products)} products configured`,
      href: "/products",
    },
    {
      label: "Store Locations",
      caption: `${grouped(counts.stores)} stores configured`,
      href: "/users",
    },
    {
      label: "Problem Categories",
      caption: `${grouped(counts.problemTypes)} problem types · ${grouped(counts.fieldOptions)} field options`,
    },
  ];

  return (
    <div className="animate-fadeUp">
      <div className="grid grid-cols-1 gap-[18px] md:grid-cols-2">
        <MasterDataCard rows={registry} />
        <div className="flex flex-col gap-[18px]">
          <SystemConfigCard initial={config} districtOptions={districtOptions} />
          <SmsTestCard plans={plans} smsReady={sms.ready} missing={sms.missing} senderId={sms.cfg.senderId} waReady={wa.ready} waMissing={wa.missing} />
          <WhatsAppOptInsCard initial={optIns} qrConfig={optInCfg} />
          <DataManagementCard />
        </div>
      </div>
    </div>
  );
}
