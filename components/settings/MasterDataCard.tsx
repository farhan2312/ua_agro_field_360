import Link from "next/link";

export type RegistryRow = {
  label: string;
  caption: string;
  href: string;
};

export function MasterDataCard({ rows }: { rows: RegistryRow[] }) {
  return (
    <div className="rounded-[14px] border border-black/[0.03] bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <div className="mb-4 text-base font-bold text-ink">Master Data</div>
      <div className="flex flex-col gap-2.5">
        {rows.map((r) => (
          <Link
            key={r.label}
            href={r.href}
            className="flex items-center justify-between rounded-[10px] bg-neutral-50 px-4 py-3 transition-colors hover:bg-neutral-100"
          >
            <div>
              <div className="text-[13px] font-semibold text-ink">{r.label}</div>
              <div className="text-[11px] text-neutral-400">{r.caption}</div>
            </div>
            <div className="text-lg text-neutral-400">→</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
