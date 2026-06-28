export interface VisitRecord {
  id: number;
  date: string;
  farmerName: string;
  village: string;
  district: string;
  crop: string;
  officer: string;
  purpose: string;
  storeName: string;
  storeId: number | null;
  avBg: string;
  needsFollowup: boolean;
}

export interface VisitFilterState {
  officer: string;
  store: string;
  type: string;
  period: string;
}

export interface VisitFilterOptions {
  officers: string[];
  stores: string[];
  types: string[];
}
