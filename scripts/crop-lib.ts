/**
 * Crop derivation from a SEEDS product name. Shared by the importer and the
 * crop-base recompute so both stay in sync.
 *
 * Rule order matters: multi-word pulse spellings ("GREEN GRAM"→moong,
 * "BLACK GRAM"→urad) MUST be tested before the bare-word chickpea rule
 * ("\bGRAM\b"→gram), otherwise "GREEN/BLACK GRAM" would mis-tag as chickpea.
 */
export const CROP_RULES: [RegExp, string][] = [
  [/PADDY|BASMATI|ARIZE|\bDHAN\b|\bRICE\b|\bSAVA\b/, "paddy"],
  [/WHEAT|GEHU|KANAK/, "wheat"],
  [/MUSTARD|SARSON|TORIA|\bRAYA\b/, "mustard"],
  [/MAIZE|\bCORN\b|MAKKA|DEKALB/, "maize"],
  [/POTATO|\bALOO\b|\bALU\b/, "potato"],
  [/SUGARCANE|GANNA/, "sugarcane"],
  [/\bPEAS?\b|MATAR/, "pea"],
  [/MASOOR|LENTIL/, "lentil"],
  [/MOONG|GREEN GRAM/, "moong"],
  [/URAD|\bURD\b|BLACK GRAM/, "urad"],
  [/ARHAR|\bTUR\b|PIGEON/, "arhar"],
  [/CHANA|CHANNA|CHICKPEA|\bGRAM\b/, "gram"], // chickpea — keep AFTER green/black gram
  [/SOYA/, "soybean"],
  [/GROUNDNUT|MOONGFALI|PEANUT/, "groundnut"],
  [/BAJRA|PEARL MILLET/, "bajra"],
  [/JOWAR|SORGHUM/, "jowar"],
  [/BARLEY|\bJAU\b/, "barley"],
  [/BERSEEM|BARSEEM/, "berseem"],
  [/ONION|PYAJ|PIYAJ/, "onion"],
  [/TOMATO|TAMATAR/, "tomato"],
  [/GARLIC|LEHSUN/, "garlic"],
  [/CHILL?I|MIRCH/, "chilli"],
  [/OKRA|BHINDI/, "okra"],
  [/CABBAGE|CAULIFLOWER|GOBHI/, "cole"],
  [/CUCUMBER|KHEERA/, "cucumber"],
  [/LAUKI|GOURD|KARELA/, "gourd"],
  [/MELON/, "melon"],
];

export function cropFromItem(item: string): string | null {
  const s = item.toUpperCase();
  for (const [re, c] of CROP_RULES) if (re.test(s)) return c;
  return null;
}
