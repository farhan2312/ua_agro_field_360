/** Plain typed data shapes passed from the server page to client/presentational subcomponents. */

export interface FarmerSale {
  id: number;
  invoice: string;
  date: string;
  items: string;
  amount: string;
  store: string;
}

export interface FarmerVisitLog {
  id: number;
  purpose: string;
  date: string;
  notes: string;
  by: string;
  /** Next-visit date the officer scheduled (display string), or "". */
  followUp: string;
}

export interface StoreOfficer {
  name: string;
}

export interface FarmerStore {
  name: string;
  code: string;
  color: string;
  address: string;
  officers: StoreOfficer[];
}

export interface FarmerDetail {
  id: number;
  name: string;
  village: string;
  district: string;
  mobile: string;
  land: string; // e.g. "4.5" or "" if null
  crop: string;
  season: string;
  soil: string;
  status: string; // lead-status display label
  segment: string; // value-tier display label
  segBg: string;
  segColor: string;
  lifecycle: string; // lifecycle display label
  lifeBg: string;
  lifeColor: string;
  salesCrops: string[]; // crops from the sales upload (labelled)
  visitCrops: string[]; // crops from field visits (labelled)
  ltv: string; // computed lifetime value, e.g. "₹0"
  saleCount: number;
  visitCount: number;
  lastPurchaseAmt: string;
  lastPurchaseDate: string;
  store: FarmerStore | null;
  sales: FarmerSale[];
  visitLog: FarmerVisitLog[];
  concerns: string;
  issues: string[];
}
