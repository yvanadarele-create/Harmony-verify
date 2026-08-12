/**
 * The Sourcing Agent (§32).
 *
 * It turns "Find 30 premium black cups for my bakery, customisable with my logo,
 * delivered to Abidjan" into a structured request the engine can execute.
 *
 * The extraction is rule-based rather than a model call, for three reasons that
 * all point the same way. It is instant, which matters on a phone on a slow
 * connection. It is deterministic, so the same sentence always sources the same
 * way and a customer asking twice does not get two different answers. And it
 * cannot hallucinate a quantity — a model that reads "30" as 300 has spent
 * someone's money.
 *
 * The model still has a job: `buildExtractionPrompt` covers the sentences the
 * rules miss, and `mergeExtraction` lets a model *fill gaps* in a rule-based
 * result without overwriting anything the rules found literally in the text.
 */

import { type CurrencyCode, type CustomizationMethod, DEFAULT_CURRENCY } from "@brandora/shared";

export type Quality = "budget" | "standard" | "premium" | "luxury";

export interface SourcingRequest {
  quantity: number;
  /** Brandora catalogue category words, not a supplier's taxonomy. */
  category: string;
  keywords: string;
  color?: string;
  quality?: Quality;
  customizationRequired: boolean;
  preferredMethod?: CustomizationMethod;
  destinationCity?: string;
  destinationCountry: string;
  currency: CurrencyCode;
}

/** Category words in all three supported languages (§23). */
const CATEGORY_WORDS: { category: string; patterns: RegExp }[] = [
  { category: "cups", patterns: /\b(cups?|gobelets?|tasses?|vasos?|copas?)\b/i },
  { category: "bottles", patterns: /\b(bottles?|bouteilles?|botellas?)\b/i },
  { category: "boxes", patterns: /\b(box(es)?|bo[îi]tes?|cajas?|cartons?)\b/i },
  { category: "bags", patterns: /\b(bags?|sacs?|bolsas?|pochons?)\b/i },
  { category: "pouches", patterns: /\b(pouch(es)?|sachets?|doypacks?)\b/i },
  { category: "containers", patterns: /\b(containers?|barquettes?|r[ée]cipients?|envases?)\b/i },
  { category: "stickers", patterns: /\b(stickers?|autocollants?|pegatinas?|[ée]tiquettes adh[ée]sives)\b/i },
  { category: "labels", patterns: /\b(labels?|[ée]tiquettes?|etiquetas?)\b/i },
  { category: "business-cards", patterns: /\b(business cards?|cartes de visite|tarjetas de visita)\b/i },
  { category: "thank-you-cards", patterns: /\b(thank[- ]?you cards?|cartes de remerciement|tarjetas de agradecimiento)\b/i },
  { category: "flyers", patterns: /\b(flyers?|d[ée]pliants?|folletos?|prospectus)\b/i },
  { category: "menus", patterns: /\b(menus?|cartes? de menu|men[úu]s?)\b/i },
  { category: "plates", patterns: /\b(plates?|assiettes?|platos?)\b/i },
  { category: "bowls", patterns: /\b(bowls?|bols?|cuencos?)\b/i },
  { category: "cutlery", patterns: /\b(cutlery|couverts?|cubiertos?)\b/i },
  { category: "t-shirts", patterns: /\b(t[- ]?shirts?|tee[- ]?shirts?|camisetas?|maillots?)\b/i },
  { category: "tote-bags", patterns: /\b(totes?|tote bags?|sacs? en toile|bolsas? de tela)\b/i },
  { category: "aprons", patterns: /\b(aprons?|tabliers?|delantales?)\b/i },
  { category: "mugs", patterns: /\b(mugs?|tazas?)\b/i },
];

const COLOR_WORDS: { color: string; patterns: RegExp }[] = [
  { color: "black", patterns: /\b(black|noirs?|negros?)\b/i },
  { color: "white", patterns: /\b(white|blancs?|blancos?)\b/i },
  { color: "kraft", patterns: /\b(kraft|brown|marrons?|marr[óo]n)\b/i },
  { color: "clear", patterns: /\b(clear|transparents?|transparentes?)\b/i },
  { color: "natural", patterns: /\b(natural|naturels?|écru|ecru)\b/i },
  { color: "gold", patterns: /\b(gold|dor[ée]s?|dorados?)\b/i },
  { color: "navy", patterns: /\b(navy|marine|azul marino)\b/i },
  { color: "sand", patterns: /\b(sand|sable|arena|beige)\b/i },
];

const QUALITY_WORDS: { quality: Quality; patterns: RegExp }[] = [
  { quality: "luxury", patterns: /\b(luxury|luxe|lujo|haut de gamme)\b/i },
  { quality: "premium", patterns: /\b(premium|qualit[ée] sup[ée]rieure|de calidad)\b/i },
  { quality: "budget", patterns: /\b(cheap|budget|pas cher|[ée]conomique|barato|econ[óo]mico)\b/i },
  { quality: "standard", patterns: /\b(standard|normal|ordinaire|corriente)\b/i },
];

const CUSTOMIZATION_WORDS =
  /\b(logo|custom(is|iz)ed?|personnalis|personaliz|brand(ed|ing)|marqu[ée]|imprim|print(ed)?|grav|engrav|broder|embroider|bordad)/i;

const METHOD_WORDS: { method: CustomizationMethod; patterns: RegExp }[] = [
  { method: "engraving", patterns: /\b(engrav|grav[ée]|grabado)\b/i },
  { method: "embroidery", patterns: /\b(embroider|brod[ée]|bordado)\b/i },
  { method: "sublimation", patterns: /\b(sublimat)\b/i },
  { method: "sticker", patterns: /\b(sticker|autocollant|pegatina|label|[ée]tiquette)\b/i },
  { method: "logo-print", patterns: /\b(print|imprim|impres|logo)\b/i },
];

/**
 * Cities Brandora delivers to often, mapped to ISO country codes.
 *
 * A lookup rather than a geocoder call: the destination decides freight, and a
 * network round trip to resolve "Abidjan" before the search even starts is
 * latency a founder feels. Unrecognised places fall through to the caller's
 * default country and the interface asks.
 */
const CITY_COUNTRY: Record<string, string> = {
  abidjan: "CI",
  bouake: "CI",
  yamoussoukro: "CI",
  dakar: "SN",
  bamako: "ML",
  ouagadougou: "BF",
  lome: "TG",
  cotonou: "BJ",
  conakry: "GN",
  accra: "GH",
  lagos: "NG",
  abuja: "NG",
  douala: "CM",
  yaounde: "CM",
  libreville: "GA",
  niamey: "NE",
  kinshasa: "CD",
  casablanca: "MA",
  paris: "FR",
  london: "GB",
  madrid: "ES",
};

const stripAccents = (value: string): string =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * Pull the quantity out of a sentence.
 *
 * Only counts a number that is not part of a size or a price — "30 cups" is a
 * quantity, "350ml cups" is not, and "cups at 500 FCFA" is not. Getting this
 * wrong in the permissive direction is the expensive failure, so anything
 * ambiguous is left for the interface to ask about.
 */
export function extractQuantity(text: string): number | undefined {
  const cleaned = text.replace(/[\u00a0\u202f\u2009]/g, " ");
  const candidates = [...cleaned.matchAll(/\b(\d{1,6})(?:\s*(?:x|units?|unit[ée]s?|unidades?|pcs?|pieces?|pi[èe]ces?))?\b/gi)];

  for (const match of candidates) {
    const raw = match[1];
    if (!raw) continue;
    const index = match.index ?? 0;
    const after = cleaned.slice(index + match[0].length, index + match[0].length + 12).toLowerCase();
    const before = cleaned.slice(Math.max(0, index - 12), index).toLowerCase();

    // A measurement or a currency, not a count.
    if (/^\s*(ml|l\b|cl|g\b|kg|mm|cm|gsm|oz|%)/.test(after)) continue;
    if (/^\s*(fcfa|xof|usd|eur|\$|€|£)/i.test(after)) continue;
    if (/(at|à|a|for|pour|por)\s*$/i.test(before)) continue;

    const value = Number.parseInt(raw, 10);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

export interface ParseOptions {
  defaultCountry?: string;
  currency?: CurrencyCode;
  /** Used when the sentence names no quantity — usually the package's. */
  defaultQuantity?: number;
}

export function parseRequirement(text: string, options: ParseOptions = {}): SourcingRequest {
  const normalised = stripAccents(text);

  const category = CATEGORY_WORDS.find((entry) => entry.patterns.test(text) || entry.patterns.test(normalised))?.category ?? "";
  const color = COLOR_WORDS.find((entry) => entry.patterns.test(text) || entry.patterns.test(normalised))?.color;
  const quality = QUALITY_WORDS.find((entry) => entry.patterns.test(text) || entry.patterns.test(normalised))?.quality;
  const customizationRequired = CUSTOMIZATION_WORDS.test(normalised);
  const preferredMethod = customizationRequired
    ? METHOD_WORDS.find((entry) => entry.patterns.test(normalised))?.method
    : undefined;

  const cityMatch = Object.keys(CITY_COUNTRY).find((city) =>
    new RegExp(`\\b${city}\\b`, "i").test(stripAccents(text).toLowerCase()),
  );

  const quantity = extractQuantity(text) ?? options.defaultQuantity ?? 0;

  // Keywords are what actually reaches the supplier search, so drop the parts
  // that mean something to Brandora and nothing to a supplier: the destination,
  // the quantity, and the customisation ask (which no supplier index matches on).
  const keywords = [quality === "premium" || quality === "luxury" ? quality : "", color, category]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    quantity,
    category,
    keywords: keywords || text.trim().slice(0, 80),
    color,
    quality,
    customizationRequired,
    preferredMethod,
    destinationCity: cityMatch ? cityMatch.replace(/^\w/, (c) => c.toUpperCase()) : undefined,
    destinationCountry: (cityMatch ? CITY_COUNTRY[cityMatch] : undefined) ?? options.defaultCountry ?? "CI",
    currency: options.currency ?? DEFAULT_CURRENCY,
  };
}

/** What the interface still has to ask about before a search is worth running. */
export function missingFields(request: SourcingRequest): string[] {
  const missing: string[] = [];
  if (request.quantity <= 0) missing.push("quantity");
  if (request.category === "") missing.push("category");
  return missing;
}

/**
 * The prompt for the model-assisted path.
 *
 * Used when the rules come back with gaps — a sentence like "I need enough cups
 * for a weekend market" has a real quantity in it that no regular expression
 * will find.
 */
export function buildExtractionPrompt(text: string): { system: string; user: string } {
  return {
    system:
      "You extract structured sourcing requirements. Return JSON only. Never guess a quantity that is not implied by the text — omit the field instead.",
    user: `Extract from this request:

"${text}"

Return: {"quantity": number|null, "category": string|null, "color": string|null, "quality": "budget"|"standard"|"premium"|"luxury"|null, "customizationRequired": boolean, "destinationCity": string|null}`,
  };
}

/**
 * Merge a model's extraction into the rule-based one.
 *
 * The rules win every contested field. A model is allowed to fill a blank, never
 * to overrule a number that appears literally in the customer's sentence — that
 * asymmetry is what keeps the model useful without letting it spend money.
 */
export function mergeExtraction(
  base: SourcingRequest,
  model: Partial<Record<"quantity" | "category" | "color" | "quality" | "destinationCity", unknown>>,
): SourcingRequest {
  const merged = { ...base };
  if (merged.quantity <= 0 && typeof model["quantity"] === "number" && model["quantity"] > 0) {
    merged.quantity = Math.round(model["quantity"]);
  }
  if (merged.category === "" && typeof model["category"] === "string") merged.category = model["category"];
  if (!merged.color && typeof model["color"] === "string") merged.color = model["color"];
  if (!merged.quality && typeof model["quality"] === "string") {
    const quality = model["quality"];
    if (quality === "budget" || quality === "standard" || quality === "premium" || quality === "luxury") {
      merged.quality = quality;
    }
  }
  if (!merged.destinationCity && typeof model["destinationCity"] === "string") {
    merged.destinationCity = model["destinationCity"];
    const country = CITY_COUNTRY[model["destinationCity"].toLowerCase()];
    if (country) merged.destinationCountry = country;
  }
  return merged;
}

/** Which sourcing path a quantity belongs on (§66). Thresholds are injected. */
export function sourcingTier(
  quantity: number,
  thresholds: { smallMax: number; mediumMax: number },
): "small" | "medium" | "large" {
  if (quantity <= thresholds.smallMax) return "small";
  if (quantity <= thresholds.mediumMax) return "medium";
  return "large";
}
