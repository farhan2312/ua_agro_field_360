/**
 * Ready-made WhatsApp template starters, in English + Hindi, for the common UA Agro campaign messages.
 * Picking one pre-fills the template builder (body + example values + category + language) so an admin
 * can submit for Meta approval in a couple of clicks. Variables are positional ({{1}},{{2}}…) as Meta
 * requires; the example values below are what Meta reviews the template against.
 */

export type PresetLang = "en" | "hi";

export interface PresetBody {
  body: string;
  examples: string[]; // one per {{n}}, in order
}

export interface WaPreset {
  key: string;
  label: string;              // menu label
  category: "MARKETING" | "UTILITY";
  vars: string[];             // human labels for {{1}},{{2}}… (helps the builder explain each slot)
  en: PresetBody;
  hi: PresetBody;
}

export const WA_PRESETS: WaPreset[] = [
  {
    key: "advance_booking",
    label: "Advance booking offer",
    category: "MARKETING",
    vars: ["Farmer name", "Last booking date", "Coupon code"],
    en: {
      body: "Namaste {{1}}! Book your potato fertiliser at UA Agro before {{2}} and get a special discount. Show code {{3}} at your nearest store.",
      examples: ["Ramesh", "10 Sep", "POT300"],
    },
    hi: {
      body: "नमस्ते {{1}}! UA Agro से {{2}} तक आलू खाद की एडवांस बुकिंग करें और खास छूट पाएं। कोड {{3}} अपने नज़दीकी स्टोर पर दिखाएं।",
      examples: ["रमेश", "10 सितंबर", "POT300"],
    },
  },
  {
    key: "discount_reminder",
    label: "Discount reminder",
    category: "MARKETING",
    vars: ["Farmer name", "Discount amount (₹)", "Coupon code"],
    en: {
      body: "{{1}}, only a few days left! Get ₹{{2}} off on potato fertiliser (minimum purchase applies). Offer code {{3}}. — UA Agro",
      examples: ["Ramesh", "300", "POT300"],
    },
    hi: {
      body: "{{1}}, कुछ ही दिन बाकी हैं! आलू खाद पर ₹{{2}} की छूट पाएं (न्यूनतम खरीद पर)। ऑफर कोड {{3}}। — UA Agro",
      examples: ["रमेश", "300", "POT300"],
    },
  },
  {
    key: "fertiliser_push",
    label: "Fertiliser purchase nudge",
    category: "MARKETING",
    vars: ["Farmer name", "Crop"],
    en: {
      body: "{{1}}, it's the right time to buy fertiliser for your {{2}} crop. Visit your UA Agro store for the best rates and expert advice.",
      examples: ["Ramesh", "potato"],
    },
    hi: {
      body: "{{1}}, आपकी {{2}} फसल के लिए खाद खरीदने का सही समय है। बेहतरीन रेट और सलाह के लिए अपने UA Agro स्टोर पर आएं।",
      examples: ["रमेश", "आलू"],
    },
  },
  {
    key: "combo_offer",
    label: "Combo offer",
    category: "MARKETING",
    vars: ["Farmer name", "Coupon code"],
    en: {
      body: "{{1}}, complete your crop protection with the UA Agro combo pack at a special price. Use code {{2}} at your store today!",
      examples: ["Ramesh", "COMBO50"],
    },
    hi: {
      body: "{{1}}, UA Agro कॉम्बो पैक के साथ अपनी फसल सुरक्षा पूरी करें, खास कीमत पर। आज ही कोड {{2}} अपने स्टोर पर इस्तेमाल करें!",
      examples: ["रमेश", "COMBO50"],
    },
  },
  {
    key: "meetup_invite",
    label: "Farmer meet (Ghoshti) invite",
    category: "MARKETING",
    vars: ["Farmer name", "Date", "Venue"],
    en: {
      body: "{{1}}, you're invited to a UA Agro farmer meet on {{2}} at {{3}}. Learn the latest crop tips and offers. See you there!",
      examples: ["Ramesh", "12 Sep", "Village panchayat hall"],
    },
    hi: {
      body: "{{1}}, आप UA Agro किसान गोष्ठी में आमंत्रित हैं — {{2}} को {{3}} पर। फसल की नई जानकारी और ऑफर पाएं। ज़रूर आएं!",
      examples: ["रमेश", "12 सितंबर", "गाँव पंचायत भवन"],
    },
  },
  {
    key: "post_purchase",
    label: "Post-purchase follow-up",
    category: "UTILITY",
    vars: ["Farmer name", "Crop"],
    en: {
      body: "Thank you {{1}} for your purchase! For any help with your {{2}} crop, reply here or visit your UA Agro store. Happy farming!",
      examples: ["Ramesh", "potato"],
    },
    hi: {
      body: "धन्यवाद {{1}}, आपकी खरीद के लिए! अपनी {{2}} फसल में किसी भी मदद के लिए यहाँ जवाब दें या UA Agro स्टोर पर आएं। शुभ खेती!",
      examples: ["रमेश", "आलू"],
    },
  },
];

/** Substitute {{1}},{{2}}… in a template body with example/sample values for a live preview. */
export function fillPreview(body: string, examples: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => examples[Number(n) - 1] || `{{${n}}}`);
}

/** Count distinct {{n}} placeholders in a body. */
export function countVars(body: string): number {
  return new Set((body.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []).map((m) => m.replace(/\D/g, ""))).size;
}
