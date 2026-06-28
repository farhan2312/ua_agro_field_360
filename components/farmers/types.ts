import type { SegmentLabel } from "@/lib/segments";

/** Segmentation summary card view-model (one per segment label). */
export interface SegmentCardVM {
  label: SegmentLabel;
  count: number;
  color: string;
  /** e.g. "₹128K total revenue" */
  revenue: string;
}

/** Filter chip view-model. `null` value === the "All" chip. */
export interface SegFilterVM {
  label: string;
  /** Segment label this chip filters to, or null for "All". */
  value: SegmentLabel | null;
  active: boolean;
}

/** A single farmer table row view-model (plain, serialisable). */
export interface FarmerRowVM {
  id: number;
  name: string;
  mobile: string;
  village: string;
  crop: string;
  /** Segment display label, or null for un-enriched real farmers. */
  segment: SegmentLabel | null;
  segBg: string;
  segColor: string;
  /** Formatted lifetime value, e.g. "₹26,200" or "—". */
  ltv: string;
  /** Formatted last visit date, e.g. "Jun 18" or "—". */
  lastVisit: string;
  storeName: string;
  storeColor: string;
  /** Lead/visit status display label, or null. */
  status: string | null;
  statusBg: string;
  statusColor: string;
  avBg: string;
  init: string;
}
