/** Plain row shapes passed from the server page to the client tables. */

export interface StoreRow {
  id: number;
  code: string;
  name: string;
  address: string;
  zone: string;
  district: string;
  color: string;
  status: string;
  ao1Name: string;
  ao1Mobile: string;
  ao2Name: string; // "" when there is no second officer
  ao2Mobile: string;
  bdmName: string;
  bdmMobile: string;
  farmerCountLabel: string;
}

export interface FarmerRow {
  id: number;
  idx: number;
  code: string;
  name: string;
  district: string;
  mobile: string;
  village: string;
  crop: string;
  storeName: string;
  storeColor: string;
  aoName: string;
  segment: string; // display label (may be "")
}

export interface EmployeeRow {
  id: number;
  idx: number;
  name: string;
  email: string;
  role: string;
  roleBg: string;
  roleColor: string;
  mobile: string;
  storeCode: string;
  storeColor: string;
  storeName: string;
}

export type MasterDataTab = "stores" | "farmers" | "employees";
