import Link from "next/link";

export function BackLink() {
  return (
    <Link
      href="/farmers"
      className="mb-[18px] inline-flex items-center gap-1.5 text-[13px] text-[#757575] cursor-pointer hover:text-[#2E7D32]"
    >
      ← Back to Farmer 360
    </Link>
  );
}
