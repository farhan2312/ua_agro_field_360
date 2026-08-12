export interface VisitRecord {
  id: number;
  date: string;
  farmerName: string;
  village: string;
  district: string;
  crop: string;
  land: string;
  officer: string;
  purpose: string;
  storeName: string;
  storeId: number | null;
  avBg: string;
  needsFollowup: boolean;
  followUp: string; // display date of the scheduled follow-up, or ""
}

export interface VisitFilterState {
  officer: string;
  store: string;
  type: string;
  period: string;
  q: string; // free-text search (farmer name / mobile / village / officer)
}

export interface VisitFilterOptions {
  officers: string[];
  stores: string[];
  types: string[];
}
