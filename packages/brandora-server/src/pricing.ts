/**
 * The authoritative price.
 *
 * This module exists to make one rule structural: **the browser is never
 * trusted for money.** A client sends product ids, quantities and a
 * customisation choice — three facts about intent. Every figure is looked up
 * server-side from the catalogue and recomputed here. There is no request shape
 * that lets a caller supply a unit price, a subtotal or a total, because no
 * function in this file accepts one.
 *
 * The same rule applies at checkout: the amount charged is read from the stored
 * quote, never from the request body.
 */

import {
  type BrandoraProduct,
  type CurrencyCode,
  type Money,
  ValidationError,
  add,
  money,
  multiply,
  roundUpTo,
  zero,
} from "@brandora/shared";
import type { PricedLine } from "@brandora/quotes";

/** What a customer may ask for. Note the absence of any price field. */
export interface RequestedLine {
  productId: string;
  quantity: number;
  customizationMethod?: string;
}

export interface PricingSettings {
  currency: CurrencyCode;
  /** Brandora's coordination fee, as a rate on goods. */
  serviceRate: number;
  /** Local handling and last-mile, as a rate on goods. */
  logisticsRate: number;
  /** Flat local delivery charge per order. */
  deliveryFlat: Money;
  /** Additional delivery charge per kilogram of shipped weight. */
  deliveryPerKg: Money;
  /** Round the customer's total up to a tidy figure. 0 disables. */
  roundingStep?: number;
}

export interface PricedPackage {
  lines: PricedLine[];
  productsTotal: Money;
  customizationTotal: Money;
  shippingTotal: Money;
  logisticsTotal: Money;
  serviceTotal: Money;
  total: Money;
  unitCount: number;
  /** Grams, used for the delivery estimate and shown to the admin. */
  weightG: number;
  /**
   * Lines whose requested quantity was raised to the product's minimum.
   * Surfaced so the interface can explain the change rather than silently
   * charging for more than the customer typed.
   */
  adjustments: { productId: string; requested: number; charged: number }[];
}

/**
 * Price a package from ids and quantities alone.
 *
 * Throws rather than skipping when a product is unknown: a basket referencing a
 * product that does not exist is a tampered or stale basket, and quietly
 * dropping the line would produce a total the customer never agreed to.
 */
export function priceProject(
  requested: readonly RequestedLine[],
  products: readonly BrandoraProduct[],
  settings: PricingSettings,
): PricedPackage {
  if (requested.length === 0) {
    throw new ValidationError("items", "a package needs at least one product");
  }

  const currency = settings.currency;
  const byId = new Map(products.map((product) => [product.id, product]));

  let productsTotal = zero(currency);
  let customizationTotal = zero(currency);
  let unitCount = 0;
  let weightG = 0;

  const lines: PricedLine[] = [];
  const adjustments: PricedPackage["adjustments"] = [];

  for (const line of requested) {
    const product = byId.get(line.productId);
    if (!product) throw new ValidationError("productId", `unknown product ${line.productId}`);
    if (product.status !== "active") {
      throw new ValidationError("productId", `${product.name} is not available`);
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new ValidationError("quantity", `invalid quantity for ${product.name}`);
    }
    if (product.indicativeUnitPrice.currency !== currency) {
      throw new ValidationError(
        "currency",
        `${product.name} is priced in ${product.indicativeUnitPrice.currency}, order is in ${currency}`,
      );
    }

    // Clamp up to the minimum rather than rejecting, and record it. Silently
    // charging for 25 when the customer typed 10 is the thing to avoid; the
    // interface reads `adjustments` and says so.
    const quantity = Math.max(line.quantity, product.minimumQuantity);
    if (quantity !== line.quantity) {
      adjustments.push({ productId: product.id, requested: line.quantity, charged: quantity });
    }
    if (product.availableQuantity < quantity) {
      throw new ValidationError("quantity", `only ${product.availableQuantity} of ${product.name} available`);
    }

    const lineProducts = multiply(product.indicativeUnitPrice, quantity);

    // Customisation is only charged when Brandora has *confirmed* the product
    // takes a logo. Charging for an unconfirmed capability is charging for a
    // promise we have not made.
    let lineCustomization = zero(currency);
    if (line.customizationMethod) {
      const customization = product.customization;
      const offered = customization.methods.includes(line.customizationMethod as never);
      if (!offered || customization.confidence !== "verified") {
        throw new ValidationError(
          "customizationMethod",
          `${product.name} does not offer confirmed ${line.customizationMethod}`,
        );
      }
      lineCustomization = add(
        multiply(customization.unitCost ?? zero(currency), quantity),
        customization.setupCost ?? zero(currency),
      );
    }

    productsTotal = add(productsTotal, lineProducts);
    customizationTotal = add(customizationTotal, lineCustomization);
    unitCount += quantity;
    weightG += (product.dimensions?.weightG ?? 0) * quantity;

    lines.push({
      productId: product.id,
      description: `${quantity} × ${product.name}`,
      quantity,
      unitPrice: product.indicativeUnitPrice,
      productsTotal: lineProducts,
      customizationTotal: lineCustomization,
      // Shipping, logistics and service are order-level, not per line. They are
      // apportioned below so the quote's lines still sum to its total.
      shippingTotal: zero(currency),
      logisticsTotal: zero(currency),
      serviceTotal: zero(currency),
    });
  }

  const goods = add(productsTotal, customizationTotal);

  // Local delivery: a flat charge plus a weight component. Deliberately *not*
  // presented as a carrier's estimate — no freight API has been called, and §38
  // forbids passing an invented figure off as a quoted one.
  const shippingTotal = add(
    settings.deliveryFlat,
    multiply(settings.deliveryPerKg, weightG / 1000),
  );

  const logisticsTotal = multiply(goods, settings.logisticsRate);
  const serviceTotal = multiply(goods, settings.serviceRate);

  const rawTotal = add(add(goods, shippingTotal), add(logisticsTotal, serviceTotal));
  const total = roundUpTo(rawTotal, settings.roundingStep ?? 0);

  // Rounding lands on the service line so the arithmetic still reconciles:
  // the lines a customer can check against a supplier stay exact.
  const rounded = money(serviceTotal.amount + (total.amount - rawTotal.amount), currency);

  const first = lines[0];
  if (first) {
    first.shippingTotal = shippingTotal;
    first.logisticsTotal = logisticsTotal;
    first.serviceTotal = rounded;
  }

  return {
    lines,
    productsTotal,
    customizationTotal,
    shippingTotal,
    logisticsTotal,
    serviceTotal: rounded,
    total,
    unitCount,
    weightG,
    adjustments,
  };
}

/**
 * Recommend products for a brand.
 *
 * Ranked, not filtered: the catalogue stays browsable and the ranking only
 * changes what surfaces first. The language in the interface is "Recommended
 * for your brand", never a claim that the ordering is objectively right.
 */
export interface RecommendationInput {
  positioning: string;
  personality: readonly string[];
  industry: string;
  quantity: number;
}

export interface RankedProduct {
  product: BrandoraProduct;
  score: number;
  /** Why it surfaced, in words a founder can read. */
  reasons: string[];
}

/** Which categories each positioning leans toward. */
const POSITIONING_AFFINITY: Record<string, string[]> = {
  luxury: ["tableware", "brand-materials"],
  premium: ["packaging", "brand-materials", "tableware"],
  "accessible-premium": ["packaging", "brand-materials"],
  contemporary: ["merchandise", "packaging"],
  affordable: ["brand-materials", "packaging"],
  "mass-market": ["packaging", "merchandise"],
};

const INDUSTRY_AFFINITY: { pattern: RegExp; subcategories: string[] }[] = [
  { pattern: /bakery|pastry|cookie|cake|food|caterin/i, subcategories: ["cups", "boxes", "bags", "thank-you-cards", "stickers"] },
  { pattern: /cafe|coffee|juice|bar|drink/i, subcategories: ["cups", "menus", "aprons", "stickers"] },
  { pattern: /beauty|skincare|cosmetic|soap|hair/i, subcategories: ["bottles", "labels", "boxes", "stickers"] },
  { pattern: /fashion|cloth|tailor|retail|accessor/i, subcategories: ["bags", "tote-bags", "business-cards", "labels"] },
  { pattern: /restaurant|kitchen/i, subcategories: ["plates", "bowls", "menus", "aprons", "containers"] },
];

export function recommendProducts(
  input: RecommendationInput,
  products: readonly BrandoraProduct[],
  limit = 8,
): RankedProduct[] {
  const categories = POSITIONING_AFFINITY[input.positioning] ?? [];
  const subcategories =
    INDUSTRY_AFFINITY.find((entry) => entry.pattern.test(input.industry))?.subcategories ?? [];

  const ranked = products
    .filter((product) => product.status === "active")
    .map((product) => {
      let score = 0;
      const reasons: string[] = [];

      if (subcategories.includes(product.subcategory)) {
        score += 40;
        reasons.push(`${product.subcategory.replace("-", " ")} is a staple for your kind of business`);
      }
      if (categories.includes(product.category)) {
        score += 20;
        reasons.push(`suits a ${input.positioning.replace("-", " ")} brand`);
      }
      if (product.customization.confidence === "verified") {
        score += 25;
        reasons.push("confirmed to carry your logo");
      }
      // Orderable at the customer's quantity is worth more than any style match:
      // a product they cannot buy is not a recommendation.
      if (product.minimumQuantity <= input.quantity && product.availableQuantity >= input.quantity) {
        score += 30;
        reasons.push(`available at ${input.quantity} units`);
      } else {
        score -= 40;
      }
      if (product.featured) score += 5;

      return { product, score, reasons };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return ranked.slice(0, limit);
}
