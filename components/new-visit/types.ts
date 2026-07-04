/** Shared wizard form shape (maps to a Farmer + Visit draft, spec §3). */
export interface VisitForm {
  // Step 0 — Farmer & Location
  name: string;
  father: string;
  mobile: string;
  village: string;
  district: string;
  visitPurpose: string;
  // Step 1 — Land & Crops
  landHolding: string;
  soil: string;
  soilTesting: string;
  waterSource: string[];
  mainCrop: string;
  crop: string[];
  otherCrops: string;
  season: string;
  cropInsured: boolean;
  // Step 2 — Products & Issues
  product: string[];
  productRequired: string[];
  currentProblem: string[];
  cropRisk: string[];
  dangerZone: string[];
  // Step 3 — Commercial & Services
  annualExpense: string;
  purchaseFreq: string;
  otherShops: string;
  fpoMember: boolean;
  contractFarming: boolean;
  dairyServices: boolean;
  whatsappAvail: boolean;
  // Step 4 — Review & Submit
  leadStatus: string;
  followUpDate: string;
}

export const INITIAL_FORM: VisitForm = {
  name: "",
  father: "",
  mobile: "",
  village: "Chandpur",
  district: "Agra",
  visitPurpose: "",
  landHolding: "",
  soil: "",
  soilTesting: "",
  waterSource: [],
  mainCrop: "",
  crop: [],
  otherCrops: "",
  season: "Rabi",
  cropInsured: false,
  product: [],
  productRequired: [],
  currentProblem: [],
  cropRisk: [],
  dangerZone: [],
  annualExpense: "",
  purchaseFreq: "",
  otherShops: "",
  fpoMember: false,
  contractFarming: false,
  dairyServices: false,
  whatsappAvail: false,
  leadStatus: "New",
  followUpDate: "",
};

/** Full record returned by the server-side mobile lookup (for autofill + edit). */
export interface FarmerLookup {
  id: number;
  name: string;
  village: string;
  district: string;
  mainCrop: string;
  segmentLabel: string | null;
  leadStatusLabel: string | null;
  ltv: string; // formatted ₹ or "—"
  lastVisit: string; // display date or "—"
}

export interface FarmerLookupResult {
  found: boolean;
  farmer?: FarmerLookup;
}
