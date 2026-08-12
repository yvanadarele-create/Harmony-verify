/**
 * The supplier adapter contract (§76).
 *
 * This interface is the single most load-bearing thing in the sourcing layer.
 * §65 says Brandora must never become permanently dependent on AliExpress, and
 * an interface is the only way that stays true — the alternative is a promise,
 * and promises lose to deadlines.
 *
 * The rule it enforces: **no supplier's vocabulary crosses this line.** Above it,
 * everything speaks `BrandoraProduct`, `SupplierOffer`, `BrandoraShippingOption`.
 * Below it, an adapter deals with whatever shape its API happens to have —
 * `aliexpress_product_id`, `ae_item_base_info_dto`, snake_case, prices as
 * strings, shipping as a nested array. Adding Alibaba, a local packaging house
 * or a direct manufacturer means writing one file, not auditing a codebase.
 */

import type {
  BrandoraShippingOption,
  BrandoraVariant,
  CurrencyCode,
  SupplierOffer,
  SupplierPlatform,
} from "@brandora/shared";

export interface SearchQuery {
  /** Free-text search terms, already normalised by the sourcing agent. */
  keywords: string;
  /** How many units the customer needs. Adapters use it to filter by MOQ. */
  quantity: number;
  category?: string;
  color?: string;
  /** Ceiling on the per-unit cost Brandora is willing to consider. */
  maxUnitCost?: number;
  currency: CurrencyCode;
  destinationCountry: string;
  page?: number;
  pageSize?: number;
}

export interface FreightQuery {
  externalProductId: string;
  quantity: number;
  destinationCountry: string;
  /** Province or city, when the carrier prices below country level. */
  destinationRegion?: string;
  currency: CurrencyCode;
}

export interface SupplierOrderRequest {
  externalProductId: string;
  variantId?: string;
  quantity: number;
  shippingOptionId: string;
  address: {
    recipient: string;
    phone: string;
    line1: string;
    line2?: string;
    city: string;
    region?: string;
    country: string;
    postalCode?: string;
  };
}

export interface SupplierOrderStatus {
  supplierOrderId: string;
  status: string;
  trackingNumber?: string;
  carrier?: string;
  /** Only when the supplier actually reported one. Never inferred (§38). */
  lastUpdate?: string;
}

export interface TrackingEvent {
  at: string;
  description: string;
  location?: string;
}

/**
 * What every supplier integration must provide.
 *
 * Methods are allowed to throw `BrandoraError` — the engine catches, logs the
 * technical detail for the admin and returns the customer-safe message (§73).
 * They are *not* allowed to invent data: an adapter that cannot get a delivery
 * estimate returns an option without one rather than guessing (§38).
 */
export interface SupplierAdapter {
  readonly platform: SupplierPlatform;
  readonly name: string;

  search(query: SearchQuery): Promise<SupplierOffer[]>;
  getOffer(externalProductId: string, currency: CurrencyCode): Promise<SupplierOffer | null>;
  getVariants(externalProductId: string, currency: CurrencyCode): Promise<BrandoraVariant[]>;
  /** Live stock check. Cheaper than a full offer fetch on most APIs. */
  checkAvailability(externalProductId: string, quantity: number): Promise<AvailabilityResult>;
  getShippingOptions(query: FreightQuery): Promise<BrandoraShippingOption[]>;
  /** Whether the supplier will ship to this country at all. */
  checkDeliveryAvailability(externalProductId: string, destinationCountry: string): Promise<boolean>;

  /** Optional: only adapters that can transact implement these. */
  placeOrder?(request: SupplierOrderRequest): Promise<SupplierOrderStatus>;
  getOrderStatus?(supplierOrderId: string): Promise<SupplierOrderStatus>;
  getTracking?(trackingNumber: string): Promise<TrackingEvent[]>;
}

export interface AvailabilityResult {
  available: boolean;
  availableQuantity: number;
  moq: number;
  /** When this was confirmed with the supplier, for the staleness label (§75). */
  checkedAt: string;
}

/**
 * The HTTP call an adapter makes, as a parameter rather than a global `fetch`.
 *
 * This is what makes the adapters testable without a network and without a
 * credential — a test supplies a transport that returns a recorded payload. It
 * also gives one place to add the retry, timeout and rate limiting §61 asks for,
 * instead of scattering them through each adapter.
 */
export interface Transport {
  post(url: string, body: URLSearchParams, signal?: AbortSignal): Promise<TransportResponse>;
}

export interface TransportResponse {
  status: number;
  text: string;
}

/** Default transport: `fetch`, with a timeout so a hung supplier cannot hang a page. */
export function fetchTransport(timeoutMs = 12_000): Transport {
  return {
    async post(url, body, signal) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      signal?.addEventListener("abort", () => controller.abort());
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
          signal: controller.signal,
        });
        return { status: response.status, text: await response.text() };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
