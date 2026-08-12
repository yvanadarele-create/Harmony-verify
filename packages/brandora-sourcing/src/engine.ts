/**
 * The Brandora Sourcing Engine (§31, §33).
 *
 *     Brandora AI → Sourcing Agent → Sourcing Engine → adapter → supplier API
 *
 * The engine is the boundary the AI is allowed to reach. It never gets an HTTP
 * client, a credential or an adapter — it gets these functions, and that is the
 * whole security model for the model: a language model that cannot construct a
 * supplier request cannot be talked into constructing a harmful one, and a
 * prompt-injected instruction in a product title has nothing to reach for.
 *
 * Everything here also enforces the rules that must not depend on the AI
 * remembering them: MOQ and stock filtering (§35), customisation honesty (§36),
 * scoring rather than cheapest-wins (§37), no invented delivery dates (§38), and
 * supplier cost privacy (§39).
 */

import {
  type BrandoraShippingOption,
  type BrandoraVariant,
  type CurrencyCode,
  type Money,
  type SupplierOffer,
  BrandoraError,
  DEFAULT_CURRENCY,
  toBrandoraError,
} from "@brandora/shared";
import type { AvailabilityResult, SupplierAdapter, SupplierOrderStatus, TrackingEvent } from "./adapter.js";
import type { SourcingRequest } from "./agent.js";
import { type ScoredOffer, type Recommendations, recommend, scoreOffer } from "./scoring.js";
import { type CustomerBreakdown, type LandedCost, calculateLandedCost, toCustomerBreakdown } from "./landed-cost.js";
import { type FreshnessLabel, type SupplierCache, MemorySupplierCache, withCache } from "./cache.js";

export interface EngineOptions {
  /** Ordered by preference. The engine queries all of them and merges (§65). */
  adapters: SupplierAdapter[];
  cache?: SupplierCache;
  cacheTtlMinutes?: number;
  marginRate: number;
  logisticsRate: number;
  roundingStep?: number;
  /** Reports technical detail to the admin channel. Never to a customer. */
  onError?: (detail: string) => void;
}

export interface SearchOutcome {
  request: SourcingRequest;
  recommendations: Recommendations;
  freshness: FreshnessLabel;
  /** Adapters that failed, so the interface can say "partial results". */
  degraded: string[];
}

export class SourcingEngine {
  private readonly cache: SupplierCache;
  private readonly ttl: number;

  constructor(private readonly options: EngineOptions) {
    this.cache = options.cache ?? new MemorySupplierCache();
    this.ttl = options.cacheTtlMinutes ?? 360;
  }

  /**
   * Report a failure to the admin channel and keep going.
   *
   * One adapter being down must not empty the shelf (§74). The customer sees
   * fewer options; the admin sees why.
   */
  private report(context: string, err: unknown): void {
    const error = toBrandoraError(err, "sourcing.unavailable");
    this.options.onError?.(`${context}: ${error.technicalDetail}`);
  }

  /* --- Tool: searchProducts --------------------------------------------- */

  /**
   * Search every adapter, filter, score and rank.
   *
   * The MOQ and stock filter happens *here*, not in the interface and not in the
   * model's judgement, because §35 is a rule about what Brandora may recommend —
   * and a rule enforced only in a prompt is a rule that fails the first time the
   * model is busy.
   */
  async searchProducts(request: SourcingRequest): Promise<SearchOutcome> {
    if (request.quantity <= 0) {
      throw new BrandoraError("input.invalid", `searchProducts called with quantity ${request.quantity}`, 400);
    }

    const key = `search:${request.keywords}:${request.quantity}:${request.destinationCountry}:${request.currency}`;
    const degraded: string[] = [];

    const { value: offers, freshness } = await withCache<SupplierOffer[]>(
      this.cache,
      key,
      this.ttl,
      this.options.adapters.map((a) => a.platform).join("+"),
      async () => {
        const results = await Promise.all(
          this.options.adapters.map(async (adapter) => {
            try {
              return await adapter.search({
                keywords: request.keywords,
                quantity: request.quantity,
                category: request.category,
                color: request.color,
                currency: request.currency,
                destinationCountry: request.destinationCountry,
              });
            } catch (err) {
              this.report(`search via ${adapter.name}`, err);
              degraded.push(adapter.name);
              return [] as SupplierOffer[];
            }
          }),
        );
        const merged = results.flat();
        if (merged.length === 0 && degraded.length === this.options.adapters.length) {
          // Every adapter failed: throw so `withCache` can fall back to stale
          // data rather than caching an empty result as if it were an answer.
          throw new BrandoraError("sourcing.unavailable", "every supplier adapter failed");
        }
        return merged;
      },
    );

    const shippingByOffer = new Map<string, BrandoraShippingOption>();
    await Promise.all(
      offers.slice(0, 8).map(async (offer) => {
        const option = await this.cheapestShipping(offer, request);
        if (option) shippingByOffer.set(offer.id, option);
      }),
    );

    const peerUnitCosts = offers.map((offer) => offer.unitCost);
    const scored = offers.map((offer) =>
      scoreOffer({
        offer,
        quantity: request.quantity,
        customizationRequired: request.customizationRequired,
        peerUnitCosts,
        shipping: shippingByOffer.get(offer.id),
      }),
    );

    return { request, recommendations: recommend(scored), freshness, degraded };
  }

  private async cheapestShipping(
    offer: SupplierOffer,
    request: SourcingRequest,
  ): Promise<BrandoraShippingOption | undefined> {
    try {
      const options = await this.calculateFreight({
        externalProductId: offer.externalProductId,
        quantity: request.quantity,
        destinationCountry: request.destinationCountry,
        currency: request.currency,
      });
      return [...options].sort((a, b) => a.cost.amount - b.cost.amount)[0];
    } catch (err) {
      this.report(`freight for ${offer.externalProductId}`, err);
      return undefined;
    }
  }

  /* --- Tool: getProductDetails ------------------------------------------ */

  async getProductDetails(
    externalProductId: string,
    currency: CurrencyCode = DEFAULT_CURRENCY,
  ): Promise<SupplierOffer | null> {
    for (const adapter of this.options.adapters) {
      try {
        const offer = await withCache<SupplierOffer | null>(
          this.cache,
          `offer:${adapter.platform}:${externalProductId}:${currency}`,
          this.ttl,
          adapter.platform,
          () => adapter.getOffer(externalProductId, currency),
        );
        if (offer.value) return offer.value;
      } catch (err) {
        this.report(`getProductDetails via ${adapter.name}`, err);
      }
    }
    return null;
  }

  /* --- Tool: getProductVariants ----------------------------------------- */

  async getProductVariants(
    externalProductId: string,
    currency: CurrencyCode = DEFAULT_CURRENCY,
  ): Promise<BrandoraVariant[]> {
    for (const adapter of this.options.adapters) {
      try {
        const variants = await adapter.getVariants(externalProductId, currency);
        if (variants.length > 0) return variants;
      } catch (err) {
        this.report(`getProductVariants via ${adapter.name}`, err);
      }
    }
    return [];
  }

  /* --- Tool: checkAvailability ------------------------------------------ */

  async checkAvailability(externalProductId: string, quantity: number): Promise<AvailabilityResult> {
    for (const adapter of this.options.adapters) {
      try {
        return await adapter.checkAvailability(externalProductId, quantity);
      } catch (err) {
        this.report(`checkAvailability via ${adapter.name}`, err);
      }
    }
    throw new BrandoraError("sourcing.unavailable", `no adapter could check ${externalProductId}`, 502);
  }

  /* --- Tool: calculateFreight ------------------------------------------- */

  /**
   * Freight (§38).
   *
   * Returns whatever the carriers actually published. Options without a delivery
   * estimate come back with `estimatedDaysMin/Max` undefined, and the interface
   * shows "Delivery estimate unavailable". Nothing in this path fills that gap.
   */
  async calculateFreight(query: {
    externalProductId: string;
    quantity: number;
    destinationCountry: string;
    destinationRegion?: string;
    currency: CurrencyCode;
  }): Promise<BrandoraShippingOption[]> {
    const key = `freight:${query.externalProductId}:${query.quantity}:${query.destinationCountry}:${query.currency}`;
    const { value } = await withCache<BrandoraShippingOption[]>(
      this.cache,
      key,
      this.ttl,
      "freight",
      async () => {
        for (const adapter of this.options.adapters) {
          try {
            const options = await adapter.getShippingOptions(query);
            if (options.length > 0) return options;
          } catch (err) {
            this.report(`calculateFreight via ${adapter.name}`, err);
          }
        }
        return [];
      },
    );
    return value;
  }

  /* --- Tool: checkDeliveryAvailability ---------------------------------- */

  async checkDeliveryAvailability(externalProductId: string, destinationCountry: string): Promise<boolean> {
    for (const adapter of this.options.adapters) {
      try {
        if (await adapter.checkDeliveryAvailability(externalProductId, destinationCountry)) return true;
      } catch (err) {
        this.report(`checkDeliveryAvailability via ${adapter.name}`, err);
      }
    }
    return false;
  }

  /* --- Tool: calculateLandedCost ---------------------------------------- */

  /** INTERNAL. Returns supplier cost. Never hand this to a customer response. */
  landedCost(input: {
    offer: SupplierOffer;
    quantity: number;
    shipping?: BrandoraShippingOption;
    customization?: SupplierOffer["customization"];
  }): LandedCost {
    return calculateLandedCost({
      ...input,
      marginRate: this.options.marginRate,
      logisticsRate: this.options.logisticsRate,
      roundingStep: this.options.roundingStep ?? 0,
    });
  }

  /** The customer-safe projection of the same calculation (§39). */
  customerPrice(input: {
    offer: SupplierOffer;
    quantity: number;
    shipping?: BrandoraShippingOption;
    customization?: SupplierOffer["customization"];
  }): CustomerBreakdown {
    return toCustomerBreakdown(this.landedCost(input));
  }

  /* --- Tool: scoreSupplier ---------------------------------------------- */

  scoreSupplier(input: {
    offer: SupplierOffer;
    quantity: number;
    customizationRequired: boolean;
    peerUnitCosts: readonly Money[];
    shipping?: BrandoraShippingOption;
  }): ScoredOffer {
    return scoreOffer(input);
  }

  /* --- Tools: order status and tracking --------------------------------- */

  async getOrderStatus(supplierOrderId: string): Promise<SupplierOrderStatus | null> {
    for (const adapter of this.options.adapters) {
      if (!adapter.getOrderStatus) continue;
      try {
        return await adapter.getOrderStatus(supplierOrderId);
      } catch (err) {
        this.report(`getOrderStatus via ${adapter.name}`, err);
      }
    }
    return null;
  }

  async getTracking(trackingNumber: string): Promise<TrackingEvent[]> {
    for (const adapter of this.options.adapters) {
      if (!adapter.getTracking) continue;
      try {
        return await adapter.getTracking(trackingNumber);
      } catch (err) {
        this.report(`getTracking via ${adapter.name}`, err);
      }
    }
    return [];
  }
}

/* --- The AI's tool surface ----------------------------------------------- */

/**
 * The tool definitions handed to the model (§33).
 *
 * The descriptions are written for the model, and they carry the rules the model
 * must not break — that it cannot call a supplier directly, that it must not
 * invent a delivery date, that a quantity is never guessed. The engine enforces
 * all three regardless; stating them here means the model rarely tries.
 */
export const SOURCING_TOOLS = [
  {
    name: "searchProducts",
    description:
      "Search Brandora's supplier network for a product. Returns ranked options with a Brandora Score, already filtered so that nothing whose minimum order exceeds the customer's quantity is recommended. Always pass the real quantity the customer stated — never a guess.",
    input: {
      quantity: "number — units the customer needs",
      keywords: "string — what to search for, e.g. 'premium black cups'",
      category: "string — Brandora category, e.g. 'cups'",
      color: "string — optional",
      customizationRequired: "boolean — whether it must carry the customer's logo",
      destinationCountry: "string — ISO 2-letter code",
    },
  },
  {
    name: "getProductDetails",
    description: "Full detail for one supplier product, by its external id.",
    input: { externalProductId: "string", currency: "string — ISO 4217" },
  },
  {
    name: "getProductVariants",
    description: "Colours, sizes and materials available for one supplier product.",
    input: { externalProductId: "string", currency: "string" },
  },
  {
    name: "checkAvailability",
    description: "Live stock and minimum-order check for a quantity.",
    input: { externalProductId: "string", quantity: "number" },
  },
  {
    name: "calculateFreight",
    description:
      "Shipping options and costs to a destination. Some options have no delivery estimate; when that happens, say 'delivery estimate unavailable'. Never state a date the carrier did not give.",
    input: {
      externalProductId: "string",
      quantity: "number",
      destinationCountry: "string",
      currency: "string",
    },
  },
  {
    name: "checkDeliveryAvailability",
    description: "Whether the supplier ships to this country at all.",
    input: { externalProductId: "string", destinationCountry: "string" },
  },
  {
    name: "customerPrice",
    description:
      "The customer-facing price breakdown for a product, quantity and shipping option. Use this for any figure shown to a customer — it is the only priced output you may quote.",
    input: { externalProductId: "string", quantity: "number", shippingOptionId: "string" },
  },
  {
    name: "getOrderStatus",
    description: "Current status of a supplier order.",
    input: { supplierOrderId: "string" },
  },
  { name: "getTracking", description: "Tracking events for a shipment.", input: { trackingNumber: "string" } },
] as const;
