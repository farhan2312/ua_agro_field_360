/** Plain, server-serializable shapes passed from the Map page into the client tree. */

export interface MapFarmer {
  id: number;
  name: string;
  mobile: string | null;
  village: string | null;
  district: string | null;
  crop: string | null;
  land: number | null;
  /** Display segment label e.g. "High Value" (null for un-enriched). */
  segment: string | null;
  /** Display lead-status / status label e.g. "Contacted". */
  status: string | null;
  /** Primary issue label or null. */
  issue: string | null;
  /** Days since most recent visit, or null when never visited. */
  daysSinceVisit: number | null;
  /** Display "Last Visit" string e.g. "Jun 18" or "—". */
  lastVisit: string;
  lat: number;
  lng: number;
  storeId: number | null;
  /** Avatar colour assigned server-side (deterministic palette). */
  avBg: string;
}

export interface MapStore {
  id: number;
  code: string;
  name: string;
  shortName: string;
  color: string;
  lat: number;
  lng: number;
  /** Count of plotted (lat/lng) farmers attached to this store. */
  farmerCount: number;
}
