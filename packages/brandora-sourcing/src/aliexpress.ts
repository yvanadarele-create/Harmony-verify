/**
 * The AliExpress adapter (§28, §76).
 *
 * AliExpress is a sourcing infrastructure provider, not the Brandora product
 * (§79). Everything AliExpress-shaped is confined to this file: the signing
 * scheme, the `aliexpress.ds.*` method names, the snake_case payloads, the habit
 * of returning numbers as strings and errors with HTTP 200. Above it, the engine
 * sees `SupplierOffer` and nothing else.
 *
 * Security posture, per §29:
 *   - Credentials arrive from `@brandora/config`, which reads the environment.
 *     Nothing is defaulted, nothing is hard-coded, nothing is committed.
 *   - This module runs server-side only. It has no browser build and must never
 *     be imported from client code.
 *   - The signature and the access token never appear in a thrown message. The
 *     redaction in `@brandora/shared` is a second line of defence; the first is
 *     that this file does not put them in strings that travel.
 *   - No credential is ever placed in an AI prompt. The AI calls the engine's
 *     tools; the engine calls this. The model never sees a request.
 */

import { createHmac } from "node:crypto";
import {
  type BrandoraShippingOption,
  type BrandoraSupplier,
  type BrandoraVariant,
  type CurrencyCode,
  type Customization,
  type CustomizationMethod,
  type QualitySignals,
  type SupplierOffer,
  BrandoraError,
} from "@brandora/shared";
import {
  aliexpressAccessToken,
  aliexpressAppKey,
  aliexpressAppSecret,
  aliexpressEndpoint,
} from "@brandora/config";
import {
  type AvailabilityResult,
  type FreightQuery,
  type SearchQuery,
  type SupplierAdapter,
  type Transport,
  fetchTransport,
} from "./adapter.js";
import { type RateSource, convert, parseSupplierAmount } from "./exchange.js";

/** The currency AliExpress prices are requested in. Converted before use. */
const SUPPLIER_CURRENCY: CurrencyCode = "USD";

export interface AliExpressOptions {
  transport?: Transport;
  rates: RateSource;
  /** Injected for tests; defaults to the environment. */
  credentials?: {
    appKey: string;
    appSecret: string;
    accessToken: string;
    endpoint: string;
  };
  now?: () => Date;
}

/**
 * Sign a request for the AliExpress open platform gateway.
 *
 * The scheme: drop empty values, sort the remaining parameters by key, join them
 * as `key + value` with no separators, and take an uppercase hex HMAC-SHA256 of
 * that string using the app secret.
 *
 * ⚠️ **Not verified against the live documentation.** The AliExpress developer
 * portal is unreachable from the environment this was written in, so this is
 * built from the platform's published algorithm as described in secondary
 * sources: parameters sorted by key, concatenated as `key + value`, HMAC-SHA256
 * with the app secret, uppercase hex, declared as `sign_method=hmac-sha256`.
 *
 * The platform has shipped more than one scheme — an MD5 variant that wraps the
 * payload in the secret (`secret + payload + secret`), an HMAC-MD5 one, and this
 * one — and picking the wrong one fails every request with an unhelpful
 * "invalid signature". **Check this against a known-good signature from the
 * AliExpress console before the first live call.** The shape of this function —
 * parameters in, signature out, no I/O — is what makes that a one-line
 * correction rather than a rewrite, and it is exported so it can be checked
 * directly.
 */
/**
 * The value sent as `sign_method`, kept beside the function that implements it
 * so the declaration and the algorithm cannot drift apart.
 */
export const SIGN_METHOD = "hmac-sha256";

export function signRequest(params: Record<string, string>, appSecret: string): string {
  const payload = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== "")
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join("");
  return createHmac("sha256", appSecret).update(payload, "utf8").digest("hex").toUpperCase();
}

/** AliExpress timestamps are `yyyy-MM-dd HH:mm:ss` in UTC. */
export function formatTimestamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

type Json = Record<string, unknown>;

const asRecord = (value: unknown): Json | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : undefined;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);

const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined;

const asNumber = (value: unknown): number | undefined => {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

/**
 * Words in a supplier's own copy that indicate a product takes branding.
 *
 * This yields `reported`, never `verified` (§36). A listing saying "custom logo"
 * is a claim by a seller, not a confirmation — the difference is visible to the
 * customer, and only an admin who has held a sample can promote it to verified.
 */
const CUSTOMIZATION_HINTS: { pattern: RegExp; method: CustomizationMethod }[] = [
  { pattern: /custom(is|iz)ed? ?logo|logo print|printed logo|own logo|custom print/i, method: "logo-print" },
  { pattern: /engrav/i, method: "engraving" },
  { pattern: /sublimat/i, method: "sublimation" },
  { pattern: /embroider/i, method: "embroidery" },
  { pattern: /custom sticker|label print/i, method: "sticker" },
];

export function inferCustomization(title: string, description = ""): Customization {
  const haystack = `${title} ${description}`;
  const methods = CUSTOMIZATION_HINTS.filter((hint) => hint.pattern.test(haystack)).map((h) => h.method);
  return methods.length > 0
    ? {
        confidence: "reported",
        methods,
        notes: "The seller's listing mentions customisation. Not yet confirmed by Brandora.",
      }
    : {
        confidence: "unknown",
        methods: [],
        notes: "The listing says nothing about branding. Confirm with the supplier before promising it.",
      };
}

export class AliExpressAdapter implements SupplierAdapter {
  readonly platform = "aliexpress" as const;
  readonly name = "AliExpress";

  private readonly transport: Transport;
  private readonly rates: RateSource;
  private readonly now: () => Date;

  constructor(private readonly options: AliExpressOptions) {
    this.transport = options.transport ?? fetchTransport();
    this.rates = options.rates;
    this.now = options.now ?? (() => new Date());
  }

  private credentials(): { appKey: string; appSecret: string; accessToken: string; endpoint: string } {
    return (
      this.options.credentials ?? {
        appKey: aliexpressAppKey(),
        appSecret: aliexpressAppSecret(),
        accessToken: aliexpressAccessToken(),
        endpoint: aliexpressEndpoint(),
      }
    );
  }

  /**
   * One call to the gateway.
   *
   * Note what is *not* in any error raised here: no signature, no token, no full
   * request body. The method name and the supplier's own error code are enough
   * for an admin to diagnose, and they are safe to store.
   */
  private async call(method: string, businessParams: Record<string, string>): Promise<Json> {
    const { appKey, appSecret, accessToken, endpoint } = this.credentials();

    const params: Record<string, string> = {
      ...businessParams,
      app_key: appKey,
      method,
      access_token: accessToken,
      timestamp: formatTimestamp(this.now()),
      // The value must name the algorithm `signRequest` actually uses. The
      // platform documents `md5`, `hmac` (HMAC-MD5) and `hmac-sha256`; plain
      // `sha256` is not one of them, so a gateway that validated it at all
      // would validate it against a different digest than we computed.
      sign_method: SIGN_METHOD,
      format: "json",
      v: "2.0",
    };
    params["sign"] = signRequest(params, appSecret);

    let response: { status: number; text: string };
    try {
      response = await this.transport.post(endpoint, new URLSearchParams(params));
    } catch (err) {
      throw new BrandoraError(
        "sourcing.unavailable",
        `${method}: transport failure — ${err instanceof Error ? err.message : String(err)}`,
        502,
      );
    }

    if (response.status < 200 || response.status >= 300) {
      throw new BrandoraError("sourcing.unavailable", `${method}: HTTP ${response.status}`, 502);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.text);
    } catch {
      throw new BrandoraError("sourcing.unavailable", `${method}: response was not JSON`, 502);
    }

    const body = asRecord(parsed);
    if (!body) throw new BrandoraError("sourcing.unavailable", `${method}: response was not an object`, 502);

    // AliExpress signals failure inside a 200 response, so the status code alone
    // is not a success check.
    const error = asRecord(body["error_response"]);
    if (error) {
      const code = asString(error["code"]) ?? "unknown";
      const message = asString(error["sub_msg"]) ?? asString(error["msg"]) ?? "no message";
      throw new BrandoraError("sourcing.unavailable", `${method}: supplier error ${code} — ${message}`, 502);
    }

    // Responses are wrapped in a per-method envelope. Unwrap generically rather
    // than naming each one: the envelope key is derivable but the platform is not
    // perfectly consistent about it, and taking the single object value works for
    // both conventions.
    const envelopeKey = Object.keys(body).find((key) => key.endsWith("_response"));
    const inner = envelopeKey ? asRecord(body[envelopeKey]) : undefined;
    return inner ?? body;
  }

  private supplierRecord(offerSource: Json): BrandoraSupplier {
    const storeId = asString(offerSource["store_id"]) ?? asString(offerSource["seller_id"]) ?? "unknown";
    const rating = asNumber(offerSource["evaluate_rate"]) ?? asNumber(offerSource["store_rate"]);
    return {
      id: `sup_ae_${storeId}`,
      name: asString(offerSource["store_name"]) ?? "AliExpress seller",
      platform: "aliexpress",
      externalId: storeId,
      // Store ratings are published as percentages; normalise to 0–1 and fall
      // back to a deliberately unflattering 0.5 rather than assuming the best.
      reliability: rating !== undefined ? Math.min(1, Math.max(0, rating / 100)) : 0.5,
      status: "active",
    };
  }

  /** Turn one AliExpress item into a Brandora offer. */
  private toOffer(item: Json, currency: CurrencyCode): SupplierOffer {
    const externalProductId =
      asString(item["product_id"]) ?? asString(item["productId"]) ?? asString(item["item_id"]) ?? "";
    const title = asString(item["product_title"]) ?? asString(item["subject"]) ?? "Untitled product";
    const rawPrice =
      asString(item["target_sale_price"]) ??
      asString(item["sale_price"]) ??
      asString(item["target_original_price"]) ??
      asString(item["original_price"]);

    const supplierCost = parseSupplierAmount(rawPrice, SUPPLIER_CURRENCY);
    const qualitySignals: QualitySignals = {
      rating: asNumber(item["evaluate_rate"]) !== undefined ? (asNumber(item["evaluate_rate"]) ?? 0) / 20 : undefined,
      reviewCount: asNumber(item["evaluation_count"]),
      orderCount: asNumber(item["lastest_volume"]) ?? asNumber(item["orders"]),
    };

    const images = [
      asString(item["product_main_image_url"]),
      ...asArray(item["product_small_image_urls"]).map(asString),
    ].filter((url): url is string => typeof url === "string" && url !== "");

    return {
      id: `sprd_ae_${externalProductId}`,
      supplierId: `sup_ae_${asString(item["store_id"]) ?? "unknown"}`,
      supplier: this.supplierRecord(item),
      externalProductId,
      productUrl: asString(item["product_detail_url"]),
      title,
      images,
      unitCost: convert(supplierCost, currency, this.rates),
      // AliExpress dropshipping listings are usually single-unit; a missing MOQ
      // means one, not "unknown", because the platform's model is retail.
      moq: asNumber(item["min_order_quantity"]) ?? 1,
      availableQuantity: asNumber(item["stock"]) ?? asNumber(item["available_stock"]) ?? 0,
      customization: inferCustomization(title, asString(item["product_description"]) ?? ""),
      qualitySignals,
      lastCheckedAt: this.now().toISOString(),
    };
  }

  async search(query: SearchQuery): Promise<SupplierOffer[]> {
    const response = await this.call("aliexpress.ds.text.search", {
      keyWord: query.keywords,
      local: "en_US",
      countryCode: query.destinationCountry,
      currency: SUPPLIER_CURRENCY,
      pageIndex: String(query.page ?? 1),
      pageSize: String(query.pageSize ?? 20),
    });

    const data = asRecord(response["data"]) ?? asRecord(response["result"]) ?? response;
    const products = asRecord(data["products"]) ?? data;
    const items = asArray(products["product"] ?? products["selection_search_product"] ?? data["products"]);

    return items
      .map(asRecord)
      .filter((item): item is Json => item !== undefined)
      .map((item) => this.toOffer(item, query.currency));
  }

  async getOffer(externalProductId: string, currency: CurrencyCode): Promise<SupplierOffer | null> {
    const response = await this.call("aliexpress.ds.product.get", {
      product_id: externalProductId,
      target_currency: SUPPLIER_CURRENCY,
      target_language: "en",
      ship_to_country: "CI",
    });
    const result = asRecord(response["result"]) ?? response;
    const base = asRecord(result["ae_item_base_info_dto"]) ?? result;
    if (Object.keys(base).length === 0) return null;
    return this.toOffer({ ...base, product_id: externalProductId }, currency);
  }

  async getVariants(externalProductId: string, currency: CurrencyCode): Promise<BrandoraVariant[]> {
    const response = await this.call("aliexpress.ds.product.get", {
      product_id: externalProductId,
      target_currency: SUPPLIER_CURRENCY,
      target_language: "en",
      ship_to_country: "CI",
    });
    const result = asRecord(response["result"]) ?? response;
    const skuModule = asRecord(result["ae_item_sku_info_dtos"]) ?? {};
    const skus = asArray(skuModule["ae_item_sku_info_d_t_o"] ?? skuModule["ae_item_sku_info_dto"]);

    return skus
      .map(asRecord)
      .filter((sku): sku is Json => sku !== undefined)
      .map((sku, index) => {
        const attributes = asArray(
          asRecord(sku["ae_sku_property_dtos"])?.["ae_sku_property_d_t_o"],
        )
          .map(asRecord)
          .filter((a): a is Json => a !== undefined);
        const label =
          attributes.map((a) => asString(a["sku_property_value"]) ?? "").filter(Boolean).join(" / ") ||
          `Option ${index + 1}`;
        const price = parseSupplierAmount(
          asString(sku["offer_sale_price"]) ?? asString(sku["sku_price"]),
          SUPPLIER_CURRENCY,
        );
        return {
          id: `var_ae_${asString(sku["sku_id"]) ?? index}`,
          productId: externalProductId,
          label,
          color: attributes.find((a) => /colou?r/i.test(asString(a["sku_property_name"]) ?? ""))
            ? asString(attributes.find((a) => /colou?r/i.test(asString(a["sku_property_name"]) ?? ""))?.["sku_property_value"])
            : undefined,
          size: undefined,
          unitPrice: convert(price, currency, this.rates),
          availableQuantity: asNumber(sku["sku_available_stock"]) ?? 0,
        } satisfies BrandoraVariant;
      });
  }

  async checkAvailability(externalProductId: string, quantity: number): Promise<AvailabilityResult> {
    const offer = await this.getOffer(externalProductId, SUPPLIER_CURRENCY);
    const checkedAt = this.now().toISOString();
    if (!offer) return { available: false, availableQuantity: 0, moq: 0, checkedAt };
    return {
      available: offer.availableQuantity >= quantity && offer.moq <= quantity,
      availableQuantity: offer.availableQuantity,
      moq: offer.moq,
      checkedAt,
    };
  }

  /**
   * Freight (§38).
   *
   * An option without a delivery estimate is returned *as* an option with no
   * estimate. The temptation is to fill the gap with a plausible number; the
   * spec forbids it, and rightly — a founder who promises a customer a date
   * Brandora invented loses that customer, not Brandora.
   */
  async getShippingOptions(query: FreightQuery): Promise<BrandoraShippingOption[]> {
    const response = await this.call("aliexpress.ds.freight.query", {
      queryDeliveryReq: JSON.stringify({
        productId: query.externalProductId,
        quantity: query.quantity,
        shipToCountry: query.destinationCountry,
        provinceCode: query.destinationRegion ?? "",
        language: "en_US",
        currency: SUPPLIER_CURRENCY,
      }),
    });

    const result = asRecord(response["result"]) ?? response;
    const list = asArray(
      asRecord(result["delivery_options"])?.["delivery_option_d_t_o"] ??
        result["delivery_options"] ??
        result["freight_list"],
    );

    return list
      .map(asRecord)
      .filter((option): option is Json => option !== undefined)
      .map((option, index) => {
        const cost = parseSupplierAmount(
          asString(option["shipping_fee_cent"]) !== undefined
            ? (asNumber(option["shipping_fee_cent"]) ?? 0) / 100
            : asString(option["shipping_fee"]),
          SUPPLIER_CURRENCY,
        );
        const minDays = asNumber(option["min_delivery_days"]);
        const maxDays = asNumber(option["max_delivery_days"]) ?? asNumber(option["delivery_date_desc"]);

        return {
          id: asString(option["code"]) ?? `ship_${index}`,
          carrier: asString(option["company"]) ?? asString(option["service_name"]) ?? "Unknown carrier",
          serviceName: asString(option["service_name"]) ?? asString(option["code"]) ?? "Standard",
          cost: convert(cost, query.currency, this.rates),
          estimatedDaysMin: minDays,
          estimatedDaysMax: maxDays,
          trackingAvailable: option["tracking"] === true || asString(option["tracking"]) === "true",
          destinationCountry: query.destinationCountry,
        } satisfies BrandoraShippingOption;
      });
  }

  async checkDeliveryAvailability(externalProductId: string, destinationCountry: string): Promise<boolean> {
    const options = await this.getShippingOptions({
      externalProductId,
      quantity: 1,
      destinationCountry,
      currency: SUPPLIER_CURRENCY,
    });
    return options.length > 0;
  }
}
