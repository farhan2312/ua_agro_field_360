/** P12M spend tiers — shared by the analytics workbench and the map cluster builder. */
export const SPEND_TIERS: { label: string; min?: number; max?: number }[] = [
  { label: "HNI · ₹12K+", min: 12000 },
  { label: "₹10–12K", min: 10000, max: 12000 },
  { label: "₹5–10K", min: 5000, max: 10000 },
  { label: "₹2.5–5K", min: 2500, max: 5000 },
  { label: "< ₹2.5K", max: 2500 },
];
