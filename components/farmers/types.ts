/** Filter chip view-model. `null` value === the "All" chip. */
export interface SegFilterVM {
  label: string;
  /** campaignSegment key this chip filters to (HNI | AT_RISK | …), or null for "All". */
  value: string | null;
  active: boolean;
}

/** A single farmer table row view-model (plain, serialisable). */
export interface FarmerRowVM {
  id: number;
  name: string;
  mobile: string;
  village: string;
  /** Canonical crop tags (sales ∪ visit), first few. */
  crops: string[];
  /** Campaign-segment display label (HNI, At Risk, …), or null when unsegmented. */
  segment: string | null;
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
