import { Card } from "@/components/ui";
import { initials } from "@/lib/format";
import type { FarmerDetail } from "./types";

function DetailRow({
  label,
  value,
  valueClass = "text-[#1A1C1A]",
  border = true,
}: {
  label: string;
  value: string;
  valueClass?: string;
  border?: boolean;
}) {
  return (
    <div
      className={`flex justify-between text-[12.5px] py-1.5 ${
        border ? "border-b border-[#F5F5F5]" : ""
      }`}
    >
      <span className="text-[#9E9E9E]">{label}</span>
      <span className={`font-semibold ${valueClass}`}>{value}</span>
    </div>
  );
}

export function FarmerProfileCard({ farmer }: { farmer: FarmerDetail }) {
  return (
    <Card className="p-[22px] col-span-2">
      <div className="flex items-center gap-4 mb-[18px]">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center font-bold text-[20px] text-white shrink-0"
          style={{ background: "linear-gradient(135deg,#2E7D32,#66BB6A)" }}
        >
          {farmer.name ? initials(farmer.name) : ""}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2.5">
            <div className="text-[18px] font-bold text-[#1A1C1A]">{farmer.name}</div>
            {farmer.segment && (
              <div
                className="px-2.5 py-[3px] rounded-[20px] text-[10px] font-bold"
                style={{ background: farmer.segBg, color: farmer.segColor }}
              >
                {farmer.segment}
              </div>
            )}
          </div>
          <div className="text-[12px] text-[#9E9E9E] mt-0.5">
            {farmer.village}
            {farmer.village && farmer.district ? ", " : ""}
            {farmer.district}
            {farmer.mobile ? ` · ${farmer.mobile}` : ""}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <DetailRow label="Land" value={`${farmer.land || "0"} acres`} />
        <DetailRow label="Crop" value={farmer.crop} />
        <DetailRow label="Season" value={farmer.season} />
        <DetailRow label="Soil" value={farmer.soil} />
        <DetailRow
          label="Lead Status"
          value={farmer.status}
          valueClass="text-[#2E7D32]"
          border={false}
        />
        <DetailRow
          label="Total Visits"
          value={String(farmer.visitCount)}
          border={false}
        />
      </div>
    </Card>
  );
}
