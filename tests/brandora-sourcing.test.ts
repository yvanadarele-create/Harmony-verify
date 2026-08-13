import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  AliExpressAdapter,
  FixedRateSource,
  MemorySupplierCache,
  SourcingEngine,
  WEIGHTS,
  calculateLandedCost,
  convert,
  extractQuantity,
  formatTimestamp,
  inferCustomization,
  mergeExtraction,
  missingFields,
  parseRequirement,
  parseSupplierAmount,
  recommend,
  scoreOffer,
  SIGN_METHOD,
  signRequest,
  sourcingTier,
  toCustomerBreakdown,
  withCache,
  type SourcingRequest,
  type SupplierAdapter,
  type Transport,
} from "@brandora/sourcing";
import { BrandoraError, type BrandoraShippingOption, type SupplierOffer, money } from "@brandora/shared";

/* --- §32 The sourcing agent ---------------------------------------------- */

describe("sourcing agent — the worked example from the spec", () => {
  const request = parseRequirement(
    "Find 30 premium black cups for my bakery. They should be customizable with my logo and deliverable to Abidjan.",
  );

  test("quantity", () => assert.equal(request.quantity, 30));
  test("category", () => assert.equal(request.category, "cups"));
  test("colour", () => assert.equal(request.color, "black"));
  test("quality", () => assert.equal(request.quality, "premium"));
  test("customisation", () => assert.equal(request.customizationRequired, true));
  test("destination", () => {
    assert.equal(request.destinationCity, "Abidjan");
    assert.equal(request.destinationCountry, "CI");
  });
});

describe("sourcing agent — quantity extraction", () => {
  test("a volume is not a quantity", () => {
    assert.equal(extractQuantity("350ml cups"), undefined);
    assert.equal(extractQuantity("I need 30 350ml cups"), 30);
  });

  test("a price is not a quantity", () => {
    assert.equal(extractQuantity("cups at 500 FCFA"), undefined);
  });

  test("a weight is not a quantity", () => {
    assert.equal(extractQuantity("280gsm canvas"), undefined);
  });

  test("explicit unit words are recognised", () => {
    assert.equal(extractQuantity("50 units of stickers"), 50);
    assert.equal(extractQuantity("20 pcs"), 20);
  });

  test("an absent quantity is absent, never guessed", () => {
    assert.equal(extractQuantity("I need some cups"), undefined);
    const request = parseRequirement("I need some cups");
    assert.equal(request.quantity, 0);
    assert.deepEqual(missingFields(request), ["quantity"]);
  });
});

describe("sourcing agent — the other two languages", () => {
  test("French", () => {
    const request = parseRequirement("Je veux 40 gobelets noirs personnalisés livrés à Dakar");
    assert.equal(request.quantity, 40);
    assert.equal(request.category, "cups");
    assert.equal(request.color, "black");
    assert.equal(request.customizationRequired, true);
    assert.equal(request.destinationCountry, "SN");
  });

  test("Spanish", () => {
    const request = parseRequirement("Necesito 100 pegatinas personalizadas para Madrid");
    assert.equal(request.quantity, 100);
    assert.equal(request.category, "stickers");
    assert.equal(request.destinationCountry, "ES");
  });
});

describe("sourcing agent — the model may fill gaps, never overrule", () => {
  test("a model cannot change a quantity the customer wrote down", () => {
    const base = parseRequirement("30 black cups");
    const merged = mergeExtraction(base, { quantity: 300 });
    assert.equal(merged.quantity, 30, "the customer's own number wins");
  });

  test("a model may supply a quantity the rules could not find", () => {
    const base = parseRequirement("enough cups for a weekend market");
    const merged = mergeExtraction(base, { quantity: 120 });
    assert.equal(merged.quantity, 120);
  });

  test("an invalid quality from a model is ignored rather than trusted", () => {
    const merged = mergeExtraction(parseRequirement("cups"), { quality: "amazing" });
    assert.equal(merged.quality, undefined);
  });
});

describe("§66 sourcing tiers are configurable, not hard-coded", () => {
  const thresholds = { smallMax: 50, mediumMax: 500 };
  test("boundaries", () => {
    assert.equal(sourcingTier(30, thresholds), "small");
    assert.equal(sourcingTier(50, thresholds), "small");
    assert.equal(sourcingTier(51, thresholds), "medium");
    assert.equal(sourcingTier(500, thresholds), "medium");
    assert.equal(sourcingTier(501, thresholds), "large");
  });

  test("changing the thresholds changes the tier", () => {
    assert.equal(sourcingTier(30, { smallMax: 20, mediumMax: 200 }), "medium");
  });
});

/* --- Currency at the supplier boundary ------------------------------------ */

describe("supplier currency conversion", () => {
  const rates = new FixedRateSource();

  test("a USD supplier price becomes an XOF cost of the right magnitude", () => {
    const supplierPrice = parseSupplierAmount("1.20", "USD");
    assert.equal(supplierPrice.amount, 120, "1.20 USD is 120 cents");
    const inXof = convert(supplierPrice, "XOF", rates);
    assert.equal(inXof.amount, 726, "1.20 USD ≈ 726 FCFA");
  });

  test("the exponent change is handled — no 100× error in either direction", () => {
    const backAgain = convert(convert(money(605, "XOF"), "USD", rates), "XOF", rates);
    assert.ok(Math.abs(backAgain.amount - 605) <= 1, `round trip drifted to ${backAgain.amount}`);
  });

  test("the XOF/EUR peg is the treaty rate", () => {
    // 1.00 EUR is 100 minor units; 655.957 XOF is 656 minor units, not 65 596.
    assert.equal(convert(money(100, "EUR"), "XOF", rates).amount, 656);
  });

  test("an unparseable supplier amount throws instead of becoming zero", () => {
    assert.throws(() => parseSupplierAmount("contact seller", "USD"));
  });
});

/* --- §28 The AliExpress adapter ------------------------------------------ */

const CREDENTIALS = {
  appKey: "test-key",
  appSecret: "test-secret",
  accessToken: "test-token",
  endpoint: "https://example.invalid/sync",
};

function stubTransport(payload: unknown, capture?: { last?: URLSearchParams }): Transport {
  return {
    async post(_url, body) {
      if (capture) capture.last = body;
      return { status: 200, text: JSON.stringify(payload) };
    },
  };
}

describe("AliExpress adapter — signing", () => {
  test("the signature is a deterministic uppercase hex HMAC over sorted parameters", () => {
    const signature = signRequest({ b: "2", a: "1" }, "secret");
    assert.match(signature, /^[0-9A-F]{64}$/);
    assert.equal(signature, signRequest({ a: "1", b: "2" }, "secret"), "parameter order must not matter");
  });

  test("empty values are excluded, so an absent optional does not change the signature", () => {
    assert.equal(signRequest({ a: "1", b: "" }, "s"), signRequest({ a: "1" }, "s"));
  });

  test("a different secret produces a different signature", () => {
    assert.notEqual(signRequest({ a: "1" }, "s1"), signRequest({ a: "1" }, "s2"));
  });

  test("timestamps are UTC in the platform's format", () => {
    assert.equal(formatTimestamp(new Date("2026-03-04T05:06:07Z")), "2026-03-04 05:06:07");
  });
});

describe("AliExpress adapter — normalisation", () => {
  const searchPayload = {
    aliexpress_ds_text_search_response: {
      data: {
        products: {
          product: [
            {
              product_id: "100500",
              product_title: "Custom Logo Matte Black Paper Cup 350ml",
              target_sale_price: "0.42",
              store_id: "77",
              store_name: "Pack Supply Co",
              evaluate_rate: "96.5",
              evaluation_count: 1_200,
              lastest_volume: 8_400,
              stock: 20_000,
              min_order_quantity: 20,
              product_main_image_url: "https://example.invalid/a.jpg",
              product_detail_url: "https://example.invalid/item/100500",
            },
          ],
        },
      },
    },
  };

  const adapter = new AliExpressAdapter({
    transport: stubTransport(searchPayload),
    rates: new FixedRateSource(),
    credentials: CREDENTIALS,
    now: () => new Date("2026-03-01T00:00:00Z"),
  });

  test("an AliExpress item becomes a Brandora offer with no AliExpress vocabulary left", () => {
    return adapter
      .search({
        keywords: "black cups",
        quantity: 30,
        currency: "XOF",
        destinationCountry: "CI",
      })
      .then((offers) => {
        const offer = offers[0]!;
        assert.equal(offer.externalProductId, "100500");
        assert.equal(offer.moq, 20);
        assert.equal(offer.availableQuantity, 20_000);
        assert.equal(offer.unitCost.currency, "XOF", "converted, not adopted");
        assert.equal(offer.unitCost.amount, 254, "0.42 USD ≈ 254 FCFA");
        assert.equal(offer.supplier.name, "Pack Supply Co");
        assert.ok(Math.abs(offer.supplier.reliability - 0.965) < 0.001);
        assert.equal(offer.lastCheckedAt, "2026-03-01T00:00:00.000Z");
      });
  });

  test("the request is signed and carries the credentials as parameters, not in the URL", async () => {
    const capture: { last?: URLSearchParams } = {};
    const spy = new AliExpressAdapter({
      transport: stubTransport(searchPayload, capture),
      rates: new FixedRateSource(),
      credentials: CREDENTIALS,
    });
    await spy.search({ keywords: "cups", quantity: 30, currency: "XOF", destinationCountry: "CI" });
    assert.ok(capture.last?.get("sign"));
    assert.equal(capture.last?.get("app_key"), "test-key");
    // The declared method must name the digest signRequest computes. `sha256`
    // is not one of the platform's documented values, and a mismatch here fails
    // every live request with "invalid signature".
    assert.equal(capture.last?.get("sign_method"), SIGN_METHOD);
    assert.equal(SIGN_METHOD, "hmac-sha256");
  });

  test("a supplier error inside a 200 response is still an error", async () => {
    const failing = new AliExpressAdapter({
      transport: stubTransport({ error_response: { code: "15", sub_msg: "invalid signature" } }),
      rates: new FixedRateSource(),
      credentials: CREDENTIALS,
    });
    await assert.rejects(
      () => failing.search({ keywords: "cups", quantity: 30, currency: "XOF", destinationCountry: "CI" }),
      (err: unknown) => err instanceof BrandoraError && err.customerMessageKey === "sourcing.unavailable",
    );
  });

  test("the customer-facing message never contains the supplier's error text", async () => {
    const failing = new AliExpressAdapter({
      transport: stubTransport({ error_response: { code: "15", sub_msg: "invalid signature" } }),
      rates: new FixedRateSource(),
      credentials: CREDENTIALS,
    });
    try {
      await failing.search({ keywords: "cups", quantity: 1, currency: "XOF", destinationCountry: "CI" });
      assert.fail("should have thrown");
    } catch (err) {
      const error = err as BrandoraError;
      assert.doesNotMatch(error.toCustomerJSON().message, /signature|15|aliexpress/i);
      assert.match(error.technicalDetail, /invalid signature/, "the admin still gets the detail");
    }
  });
});

/* --- §36 Customisation is reported, never assumed ------------------------- */

describe("customisation inference", () => {
  test("a listing that mentions a custom logo is 'reported', not 'verified'", () => {
    const result = inferCustomization("Custom Logo Printed Paper Cups");
    assert.equal(result.confidence, "reported");
    assert.deepEqual(result.methods, ["logo-print"]);
  });

  test("a listing that says nothing is 'unknown', and says so", () => {
    const result = inferCustomization("Plain Paper Cups 250ml");
    assert.equal(result.confidence, "unknown");
    assert.equal(result.methods.length, 0);
    assert.match(result.notes!, /Confirm with the supplier/);
  });
});

/* --- §37 Supplier scoring ------------------------------------------------- */

function offer(overrides: Partial<SupplierOffer> = {}): SupplierOffer {
  return {
    id: "sprd_1",
    supplierId: "sup_1",
    supplier: {
      id: "sup_1",
      name: "Test supplier",
      platform: "aliexpress",
      externalId: "1",
      reliability: 0.9,
      status: "active",
    },
    externalProductId: "1",
    title: "Cup",
    images: [],
    unitCost: money(250, "XOF"),
    moq: 10,
    availableQuantity: 5_000,
    customization: { confidence: "verified", methods: ["logo-print"] },
    qualitySignals: { rating: 4.7, reviewCount: 1_000, orderCount: 5_000 },
    lastCheckedAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

const shipping = (days?: number): BrandoraShippingOption => ({
  id: "s1",
  carrier: "Test Post",
  serviceName: "Standard",
  cost: money(6_000, "XOF"),
  estimatedDaysMin: days,
  estimatedDaysMax: days,
  trackingAvailable: true,
  destinationCountry: "CI",
});

describe("supplier scoring", () => {
  const peers = [money(200, "XOF"), money(250, "XOF"), money(400, "XOF")];

  test("the weights sum to one, so the score really is out of 100", () => {
    const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `weights sum to ${total}`);
  });

  test("the cheapest option does not automatically win", () => {
    const cheapAndBad = scoreOffer({
      offer: offer({
        unitCost: money(200, "XOF"),
        customization: { confidence: "unknown", methods: [] },
        supplier: { ...offer().supplier, reliability: 0.3 },
        qualitySignals: {},
      }),
      quantity: 30,
      customizationRequired: true,
      peerUnitCosts: peers,
      shipping: shipping(20),
    });
    const dearerAndGood = scoreOffer({
      offer: offer({ unitCost: money(250, "XOF") }),
      quantity: 30,
      customizationRequired: true,
      peerUnitCosts: peers,
      shipping: shipping(20),
    });
    assert.ok(
      dearerAndGood.score > cheapAndBad.score,
      `${dearerAndGood.score} should beat ${cheapAndBad.score}`,
    );
  });

  test("a missing delivery estimate scores neutral, never fast", () => {
    const unknown = scoreOffer({ offer: offer(), quantity: 30, customizationRequired: true, peerUnitCosts: peers, shipping: shipping(undefined) });
    const fast = scoreOffer({ offer: offer(), quantity: 30, customizationRequired: true, peerUnitCosts: peers, shipping: shipping(7) });
    const slow = scoreOffer({ offer: offer(), quantity: 30, customizationRequired: true, peerUnitCosts: peers, shipping: shipping(55) });
    assert.ok(unknown.score < fast.score, "silence must not beat a fast published estimate");
    assert.ok(unknown.score > slow.score, "silence should not be punished as if it were slow");
  });

  test("every factor carries a reason a customer could read", () => {
    const scored = scoreOffer({ offer: offer(), quantity: 30, customizationRequired: true, peerUnitCosts: peers, shipping: shipping(14) });
    assert.equal(scored.factors.length, 8);
    for (const factor of scored.factors) assert.ok(factor.reason.length > 0, `${factor.name} has no reason`);
  });

  test("an MOQ above the order is a disqualifier, not just a low score", () => {
    const scored = scoreOffer({ offer: offer({ moq: 500 }), quantity: 30, customizationRequired: true, peerUnitCosts: peers });
    assert.equal(scored.disqualifiers.length, 1);
    assert.match(scored.disqualifiers[0]!, /Minimum order 500/);
  });

  test("a 5.0 rating from three buyers does not beat a 4.6 from thousands", () => {
    const thin = scoreOffer({ offer: offer({ qualitySignals: { rating: 5, reviewCount: 3 } }), quantity: 30, customizationRequired: true, peerUnitCosts: peers });
    const deep = scoreOffer({ offer: offer({ qualitySignals: { rating: 4.6, reviewCount: 5_000, orderCount: 20_000 } }), quantity: 30, customizationRequired: true, peerUnitCosts: peers });
    const thinQuality = thin.factors.find((f) => f.name === "Quality signals")!.value;
    const deepQuality = deep.factors.find((f) => f.name === "Quality signals")!.value;
    assert.ok(deepQuality > thinQuality, `${deepQuality} should beat ${thinQuality}`);
  });
});

describe("recommendations", () => {
  const peers = [money(200, "XOF"), money(250, "XOF"), money(400, "XOF")];
  const build = (o: SupplierOffer, days?: number) =>
    scoreOffer({ offer: o, quantity: 30, customizationRequired: true, peerUnitCosts: peers, shipping: shipping(days) });

  test("a disqualified offer is never the best match", () => {
    const result = recommend([
      build(offer({ id: "a", moq: 500, unitCost: money(200, "XOF") }), 10),
      build(offer({ id: "b" }), 20),
    ]);
    assert.equal(result.bestMatch?.offer.id, "b");
    assert.equal(result.all.length, 2, "it is still listed, just not recommended");
  });

  test("'fastest' is omitted entirely when nothing published an estimate (§38)", () => {
    const result = recommend([build(offer({ id: "a" })), build(offer({ id: "b" }))]);
    assert.equal(result.fastest, undefined);
    assert.ok(result.bestMatch, "the other recommendations still work");
  });

  test("lowest cost is by unit cost, independent of the score", () => {
    const result = recommend([
      build(offer({ id: "dear", unitCost: money(400, "XOF") }), 5),
      build(offer({ id: "cheap", unitCost: money(200, "XOF"), supplier: { ...offer().supplier, reliability: 0.4 } }), 40),
    ]);
    assert.equal(result.lowestCost?.offer.id, "cheap");
  });

  test("when everything is disqualified there is no recommendation at all", () => {
    const result = recommend([build(offer({ id: "a", moq: 500 })), build(offer({ id: "b", moq: 900 }))]);
    assert.equal(result.bestMatch, undefined);
    assert.equal(result.all.length, 2);
  });
});

/* --- §39 Landed cost and cost privacy ------------------------------------- */

describe("landed cost", () => {
  const cost = calculateLandedCost({
    offer: offer({ unitCost: money(250, "XOF") }),
    quantity: 30,
    shipping: shipping(14),
    customization: { confidence: "verified", methods: ["logo-print"], unitCost: money(45, "XOF"), setupCost: money(0, "XOF") },
    marginRate: 0.35,
    logisticsRate: 0.08,
  });

  test("the arithmetic follows the formula in the spec", () => {
    assert.equal(cost.supplierTotal.amount, 7_500, "250 × 30");
    assert.equal(cost.customizationTotal.amount, 1_350, "45 × 30");
    assert.equal(cost.shippingTotal.amount, 6_000);
    assert.equal(cost.logisticsTotal.amount, 708, "8% of 8 850 goods");
    assert.equal(cost.landedTotal.amount, 15_558);
    assert.equal(cost.marginTotal.amount, 5_445, "35% of landed");
    assert.equal(cost.customerTotal.amount, 21_003);
  });

  test("every step is recorded for an admin reconstructing a disputed quote", () => {
    assert.equal(cost.breakdown.length, 7);
    assert.match(cost.breakdown.join("\n"), /margin 0\.35/);
  });

  test("logistics is charged on goods, not on freight — no double-dipping", () => {
    const goods = cost.supplierTotal.amount + cost.customizationTotal.amount;
    assert.equal(cost.logisticsTotal.amount, Math.round(goods * 0.08));
  });

  test("the customer view contains no supplier cost, at any depth", () => {
    const customer = toCustomerBreakdown(cost);
    const serialised = JSON.stringify(customer);
    assert.ok(!serialised.includes(String(cost.supplierTotal.amount)), "supplier total leaked");
    assert.ok(!serialised.includes(String(cost.marginTotal.amount)), "margin leaked");
    assert.ok(!("supplierUnitCost" in (customer as object)));
  });

  test("the customer's lines add up to the total they are asked to pay", () => {
    const customer = toCustomerBreakdown(cost);
    const parts =
      customer.productsTotal.amount +
      customer.customizationTotal.amount +
      customer.shippingTotal.amount +
      customer.logisticsTotal.amount +
      customer.serviceTotal.amount;
    assert.equal(parts, customer.total.amount);
  });

  test("the lines still reconcile when freight dwarfs the goods", () => {
    const lopsided = calculateLandedCost({
      offer: offer({ unitCost: money(10, "XOF") }),
      quantity: 1,
      shipping: { ...shipping(10), cost: money(90_000, "XOF") },
      marginRate: 0.35,
      logisticsRate: 0.08,
    });
    const customer = toCustomerBreakdown(lopsided);
    const parts =
      customer.productsTotal.amount +
      customer.customizationTotal.amount +
      customer.shippingTotal.amount +
      customer.logisticsTotal.amount +
      customer.serviceTotal.amount;
    assert.equal(parts, customer.total.amount);
    assert.ok(customer.productsTotal.amount >= 0);
  });

  test("rounding only ever goes up", () => {
    const rounded = calculateLandedCost({
      offer: offer({ unitCost: money(250, "XOF") }),
      quantity: 30,
      shipping: shipping(14),
      marginRate: 0.35,
      logisticsRate: 0.08,
      roundingStep: 100,
    });
    assert.equal(rounded.customerTotal.amount % 100, 0);
    assert.ok(rounded.customerTotal.amount >= rounded.landedTotal.amount + rounded.marginTotal.amount);
  });
});

/* --- §74, §75 Caching and the outage fallback ---------------------------- */

describe("supplier cache", () => {
  test("a fresh entry is served without calling the supplier", async () => {
    const cache = new MemorySupplierCache();
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return "value";
    };
    await withCache(cache, "k", 60, "test", fetcher);
    const second = await withCache(cache, "k", 60, "test", fetcher);
    assert.equal(calls, 1);
    assert.equal(second.value, "value");
  });

  test("an entry past its TTL is refreshed", async () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const cache = new MemorySupplierCache({ now: () => now });
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return calls;
    };
    await withCache(cache, "k", 60, "test", fetcher);
    now = new Date("2026-01-01T02:00:00Z");
    const result = await withCache(cache, "k", 60, "test", fetcher);
    assert.equal(calls, 2);
    assert.equal(result.value, 2);
  });

  test("when the supplier is down, stale data is served and labelled as stale", async () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const cache = new MemorySupplierCache({ now: () => now });
    await withCache(cache, "k", 60, "test", async () => "cached answer");

    now = new Date("2026-01-01T14:00:00Z");
    const result = await withCache(cache, "k", 60, "test", async () => {
      throw new BrandoraError("sourcing.unavailable", "supplier down");
    });

    assert.equal(result.value, "cached answer", "§74: keep working from what we have");
    assert.equal(result.freshness.live, false);
    assert.match(result.freshness.note, /supplier API was unavailable/);
    assert.equal(result.freshness.ageMinutes, 840);
  });

  test("with nothing cached, an outage is an error rather than a silent empty result", async () => {
    const cache = new MemorySupplierCache();
    await assert.rejects(() =>
      withCache(cache, "k", 60, "test", async () => {
        throw new BrandoraError("sourcing.unavailable", "supplier down");
      }),
    );
  });

  test("stale keys are reported for the background refresh", () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const cache = new MemorySupplierCache({ now: () => now });
    cache.set("old", 1, "test");
    now = new Date("2026-01-01T10:00:00Z");
    cache.set("new", 2, "test");
    assert.deepEqual(cache.staleKeys(60), ["old"]);
  });
});

/* --- §31, §33 The engine -------------------------------------------------- */

function fakeAdapter(overrides: Partial<SupplierAdapter> = {}): SupplierAdapter {
  return {
    platform: "aliexpress",
    name: "Fake",
    search: async () => [offer({ id: "a", unitCost: money(250, "XOF") }), offer({ id: "b", unitCost: money(300, "XOF"), moq: 500 })],
    getOffer: async () => offer(),
    getVariants: async () => [],
    checkAvailability: async () => ({ available: true, availableQuantity: 100, moq: 10, checkedAt: "2026-03-01T00:00:00.000Z" }),
    getShippingOptions: async () => [shipping(15)],
    checkDeliveryAvailability: async () => true,
    ...overrides,
  };
}

const request: SourcingRequest = {
  quantity: 30,
  category: "cups",
  keywords: "black cups",
  customizationRequired: true,
  destinationCountry: "CI",
  currency: "XOF",
};

describe("sourcing engine", () => {
  test("results come back ranked, with the unfulfillable option demoted", async () => {
    const engine = new SourcingEngine({ adapters: [fakeAdapter()], marginRate: 0.35, logisticsRate: 0.08 });
    const outcome = await engine.searchProducts(request);
    assert.equal(outcome.recommendations.bestMatch?.offer.id, "a");
    assert.equal(outcome.recommendations.all.length, 2);
    assert.equal(outcome.degraded.length, 0);
  });

  test("a quantity of zero is refused before any supplier is called", async () => {
    const engine = new SourcingEngine({ adapters: [fakeAdapter()], marginRate: 0.35, logisticsRate: 0.08 });
    await assert.rejects(() => engine.searchProducts({ ...request, quantity: 0 }));
  });

  test("one failing adapter degrades the results instead of emptying the shelf", async () => {
    const errors: string[] = [];
    const engine = new SourcingEngine({
      adapters: [
        fakeAdapter({ name: "Broken", search: async () => { throw new Error("boom"); } }),
        fakeAdapter({ name: "Working" }),
      ],
      marginRate: 0.35,
      logisticsRate: 0.08,
      onError: (detail) => errors.push(detail),
    });
    const outcome = await engine.searchProducts(request);
    assert.ok(outcome.recommendations.bestMatch, "the working adapter still returns options");
    assert.deepEqual(outcome.degraded, ["Broken"]);
    assert.equal(errors.length, 1, "the admin is told; the customer is not");
  });

  test("freight failing does not fail the search — options come back without estimates", async () => {
    const engine = new SourcingEngine({
      adapters: [fakeAdapter({ getShippingOptions: async () => { throw new Error("freight down"); } })],
      marginRate: 0.35,
      logisticsRate: 0.08,
    });
    const outcome = await engine.searchProducts(request);
    assert.ok(outcome.recommendations.bestMatch);
    assert.equal(outcome.recommendations.fastest, undefined, "no invented delivery estimate");
  });

  test("the customer price path returns no supplier cost", async () => {
    const engine = new SourcingEngine({ adapters: [fakeAdapter()], marginRate: 0.35, logisticsRate: 0.08 });
    const breakdown = engine.customerPrice({ offer: offer(), quantity: 30, shipping: shipping(12) });
    assert.ok(!("supplierTotal" in (breakdown as object)));
    assert.ok(breakdown.total.amount > 0);
  });
});
