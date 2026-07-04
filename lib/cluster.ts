/** Types + constants for the Cluster Builder (kept out of the "use server" file). */

export const PAGE_SIZE = 25;
export const MAX_CLUSTER = 25_000;

export interface FarmerFilters {
  villages?: string[]; // multi-select villages
  crop?: string;
  segment?: string; // display label
  leadStatus?: string; // display label
  category?: string; // product category from sales
  q?: string;
}

export interface VillageFacet {
  village: string;
  count: number;
}

export interface StoreFarmerRow {
  id: number;
  name: string;
  mobile: string | null;
  village: string | null;
  crop: string | null;
  segment: string | null; // label
  leadStatus: string | null; // label
  ltv: number;
  bills: number;
}

export interface StoreFarmersResult {
  rows: StoreFarmerRow[];
  total: number;
  page: number;
  pageSize: number;
  villages: VillageFacet[]; // per-store, with farmer counts, biggest first
  crops: string[]; // per-store
  categories: string[]; // per-store (products purchased)
}

export interface CreateClusterInput {
  name: string;
  storeIds: number[];
  storeName: string;
  filters: FarmerFilters;
  /** Explicitly checked farmer ids (when not selecting all matching). */
  explicitIds?: number[];
  /** Select every farmer matching the current filters instead of just `explicitIds`. */
  allMatching?: boolean;
}

export interface CreateClusterResult {
  ok: boolean;
  count?: number;
  error?: string;
}
