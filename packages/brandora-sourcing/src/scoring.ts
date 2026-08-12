/**
 * The Brandora Score (§37).
 *
 * "Do not simply choose the cheapest supplier." The cheapest cup that arrives in
 * nine weeks, cannot take a logo, and comes from a seller with two reviews is
 * not the best cup — it is the fastest way to lose a customer who was trusting
 * Brandora to know better.
 *
 * Two properties matter more than the exact weights.
 *
 * **Missing information never scores as good news.** A supplier that publishes
 * no delivery estimate scores the same as an average one, not the same as a fast
 * one. Absence of evidence is not evidence, and a scoring function that rewards
 * silence teaches suppliers to stay silent.
 *
 * **Every score carries its reasons.** A recommendation a customer cannot
 * interrogate is a recommendation they cannot trust, and an admin debugging a
 * strange ranking needs the arithmetic, not a number.
 */

import type { Money, SupplierOffer } from "@brandora/shared";
import { compare } from "@brandora/shared";
import type { BrandoraShippingOption } from "@brandora/shared";

export interface ScoreInput {
  offer: SupplierOffer;
  quantity: number;
  customizationRequired: boolean;
  /** Every offer's per-unit cost in this run, for relative price scoring. */
  peerUnitCosts: readonly Money[];
  shipping?: BrandoraShippingOption;
}

export interface ScoreFactor {
  name: string;
  /** 0–1 before weighting. */
  value: number;
  weight: number;
  reason: string;
}

export interface ScoredOffer {
  offer: SupplierOffer;
  /** 0–100, rounded. */
  score: number;
  factors: ScoreFactor[];
  shipping?: BrandoraShippingOption;
  /** Hard failures. A disqualified offer is never a primary recommendation. */
  disqualifiers: string[];
}

/**
 * Weights. Exported so tuning them is a one-line change rather than a hunt, and
 * so a test can assert they still sum to one.
 */
export const WEIGHTS = {
  price: 0.28,
  moq: 0.16,
  stock: 0.12,
  customization: 0.16,
  shipping: 0.1,
  delivery: 0.08,
  reliability: 0.06,
  quality: 0.04,
} as const;

/** Used wherever a signal is absent — mid, never generous. */
const UNKNOWN = 0.5;

function priceScore(unitCost: Money, peers: readonly Money[]): { value: number; reason: string } {
  const comparable = peers.filter((p) => p.currency === unitCost.currency);
  if (comparable.length < 2) return { value: UNKNOWN, reason: "Not enough offers to compare on price" };

  const amounts = comparable.map((p) => p.amount);
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  if (max === min) return { value: 1, reason: "Every offer is the same price" };

  // Linear, cheapest = 1. Not a rank: a listing that is barely more expensive
  // than the cheapest should barely lose, and rank-based scoring erases that.
  const value = (max - unitCost.amount) / (max - min);
  return {
    value,
    reason:
      value >= 0.99
        ? "Cheapest per unit of everything we found"
        : value <= 0.01
          ? "Most expensive per unit of everything we found"
          : `Priced ${Math.round(value * 100)}% of the way from the most to the least expensive`,
  };
}

function moqScore(offer: SupplierOffer, quantity: number): { value: number; reason: string } {
  if (offer.moq > quantity) {
    return { value: 0, reason: `Minimum order is ${offer.moq}, you need ${quantity}` };
  }
  // Comfortably under the customer's quantity is better than exactly at it —
  // it leaves room to reorder smaller next time.
  const headroom = quantity > 0 ? 1 - offer.moq / quantity : UNKNOWN;
  return {
    value: Math.max(0, Math.min(1, headroom)),
    reason:
      offer.moq <= 1
        ? "No meaningful minimum — order any quantity"
        : `Minimum order is ${offer.moq}, comfortably under your ${quantity}`,
  };
}

function stockScore(offer: SupplierOffer, quantity: number): { value: number; reason: string } {
  if (offer.availableQuantity <= 0) {
    return { value: UNKNOWN, reason: "Stock not published" };
  }
  if (offer.availableQuantity < quantity) {
    return { value: 0, reason: `Only ${offer.availableQuantity} in stock, you need ${quantity}` };
  }
  const ratio = offer.availableQuantity / Math.max(1, quantity);
  return {
    value: Math.min(1, ratio / 5),
    reason:
      ratio >= 5
        ? "Deep stock — reorders will not be a problem"
        : `${offer.availableQuantity} in stock against your ${quantity}`,
  };
}

function customizationScore(
  offer: SupplierOffer,
  required: boolean,
): { value: number; reason: string } {
  const { confidence } = offer.customization;
  if (!required) {
    return { value: UNKNOWN, reason: "Customisation not requested" };
  }
  switch (confidence) {
    case "verified":
      return { value: 1, reason: "Brandora has confirmed this product takes your logo" };
    case "reported":
      return { value: 0.7, reason: "The seller says it can be customised — not yet confirmed by us" };
    case "unknown":
      return { value: 0.2, reason: "Nothing in the listing confirms it takes a logo" };
    case "unavailable":
      return { value: 0, reason: "This product cannot be customised" };
  }
}

function shippingScore(option: BrandoraShippingOption | undefined): { value: number; reason: string } {
  if (!option) return { value: UNKNOWN, reason: "Shipping not quoted for this destination yet" };
  return { value: option.trackingAvailable ? 1 : 0.6, reason: option.trackingAvailable ? `${option.carrier}, tracked` : `${option.carrier}, untracked` };
}

/**
 * Delivery speed.
 *
 * Returns `UNKNOWN` when no estimate was published — §38 again. A carrier that
 * does not commit to a date must not out-rank one that commits to a slow date.
 */
function deliveryScore(option: BrandoraShippingOption | undefined): { value: number; reason: string } {
  const days = option?.estimatedDaysMax ?? option?.estimatedDaysMin;
  if (days === undefined) return { value: UNKNOWN, reason: "Delivery estimate unavailable" };
  // 7 days or fewer is excellent; 60 or more is as bad as it gets.
  const value = Math.max(0, Math.min(1, (60 - days) / 53));
  return { value, reason: `Around ${days} days to arrive` };
}

function reliabilityScore(offer: SupplierOffer): { value: number; reason: string } {
  return {
    value: Math.max(0, Math.min(1, offer.supplier.reliability)),
    reason: `Supplier reliability ${Math.round(offer.supplier.reliability * 100)}%`,
  };
}

function qualityScore(signals: SupplierOffer["qualitySignals"]): { value: number; reason: string } {
  const { rating, reviewCount, orderCount } = signals;
  if (rating === undefined && !reviewCount && !orderCount) {
    return { value: UNKNOWN, reason: "No reviews or order history published" };
  }
  const ratingPart = rating !== undefined ? Math.max(0, Math.min(1, rating / 5)) : UNKNOWN;
  // Volume is evidence that the rating means something. A 5.0 from three buyers
  // is weaker than a 4.6 from three thousand, and a raw average hides that.
  const volume = (reviewCount ?? 0) + (orderCount ?? 0);
  const confidence = Math.min(1, Math.log10(volume + 1) / 3);
  const value = ratingPart * (0.6 + 0.4 * confidence);
  return {
    value,
    reason:
      rating !== undefined
        ? `Rated ${rating.toFixed(1)}/5 across ${volume.toLocaleString("en-GB")} reviews and orders`
        : `${volume.toLocaleString("en-GB")} reviews and orders, no published rating`,
  };
}

export function scoreOffer(input: ScoreInput): ScoredOffer {
  const { offer, quantity, customizationRequired, peerUnitCosts, shipping } = input;

  const parts: [keyof typeof WEIGHTS, { value: number; reason: string }, string][] = [
    ["price", priceScore(offer.unitCost, peerUnitCosts), "Price"],
    ["moq", moqScore(offer, quantity), "Minimum order"],
    ["stock", stockScore(offer, quantity), "Stock"],
    ["customization", customizationScore(offer, customizationRequired), "Customisation"],
    ["shipping", shippingScore(shipping), "Shipping"],
    ["delivery", deliveryScore(shipping), "Delivery time"],
    ["reliability", reliabilityScore(offer), "Supplier"],
    ["quality", qualityScore(offer.qualitySignals), "Quality signals"],
  ];

  const factors: ScoreFactor[] = parts.map(([key, result, name]) => ({
    name,
    value: result.value,
    weight: WEIGHTS[key],
    reason: result.reason,
  }));

  const score = factors.reduce((total, factor) => total + factor.value * factor.weight, 0);

  const disqualifiers: string[] = [];
  if (offer.moq > quantity) disqualifiers.push(`Minimum order ${offer.moq} exceeds your ${quantity}`);
  if (offer.availableQuantity > 0 && offer.availableQuantity < quantity) {
    disqualifiers.push(`Only ${offer.availableQuantity} available`);
  }
  if (customizationRequired && offer.customization.confidence === "unavailable") {
    disqualifiers.push("Cannot carry your logo");
  }

  return { offer, score: Math.round(score * 100), factors, shipping, disqualifiers };
}

export interface Recommendations {
  /** Highest Brandora score among offers that can actually fulfil the order. */
  bestMatch?: ScoredOffer;
  lowestCost?: ScoredOffer;
  /** Only when at least one offer published a delivery estimate (§38). */
  fastest?: ScoredOffer;
  /** Everything scored, ranked, including the disqualified. */
  all: ScoredOffer[];
}

/**
 * Rank and label.
 *
 * Disqualified offers stay in `all` but are never promoted to a headline
 * recommendation — §35 says a product that cannot satisfy the order must not be
 * a primary option, while hiding it entirely would leave a customer wondering
 * why the cup they found elsewhere is missing.
 */
export function recommend(scored: readonly ScoredOffer[]): Recommendations {
  const all = [...scored].sort((a, b) => b.score - a.score);
  const eligible = all.filter((s) => s.disqualifiers.length === 0);
  if (eligible.length === 0) return { all };

  const lowestCost = [...eligible].sort((a, b) => compare(a.offer.unitCost, b.offer.unitCost))[0];

  const withEstimates = eligible.filter(
    (s) => (s.shipping?.estimatedDaysMax ?? s.shipping?.estimatedDaysMin) !== undefined,
  );
  const fastest =
    withEstimates.length > 0
      ? [...withEstimates].sort(
          (a, b) =>
            (a.shipping?.estimatedDaysMax ?? a.shipping?.estimatedDaysMin ?? Infinity) -
            (b.shipping?.estimatedDaysMax ?? b.shipping?.estimatedDaysMin ?? Infinity),
        )[0]
      : undefined;

  return { bestMatch: eligible[0], lowestCost, fastest, all };
}
