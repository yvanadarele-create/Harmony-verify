import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_VALIDITY_DAYS,
  ORDER_TRANSITIONS,
  createOrder,
  createQuote,
  depositAmount,
  isCancellable,
  isExpired,
  notificationFor,
  orderProgress,
  quoteReconciles,
  quoteReference,
  quoteRows,
  transitionOrder,
  transitionQuote,
  type PricedLine,
} from "@brandora/quotes";
import {
  BrandoraError,
  ValidationError,
  type BrandPackage,
  type BrandProfile,
  money,
} from "@brandora/shared";

const NOW = new Date("2026-03-01T00:00:00Z");

const brand = { id: "brn_1", name: "Luma" } as BrandProfile;
const pkg = { id: "pkg_1", currency: "XOF" } as BrandPackage;

const line = (overrides: Partial<PricedLine> = {}): PricedLine => ({
  productId: "prd_cup_kraft_250",
  description: "30 branded cups",
  quantity: 30,
  unitPrice: money(500, "XOF"),
  productsTotal: money(15_000, "XOF"),
  customizationTotal: money(1_350, "XOF"),
  shippingTotal: money(6_000, "XOF"),
  logisticsTotal: money(708, "XOF"),
  serviceTotal: money(1_900, "XOF"),
  ...overrides,
});

/* --- §43 The quote engine ------------------------------------------------ */

describe("quote engine", () => {
  const quote = createQuote({ brand, package: pkg, lines: [line()], now: NOW, sequence: 43 });

  test("the reference is something a person can read down a phone line", () => {
    assert.equal(quote.reference, "BRA-2026-0043");
    assert.equal(quoteReference(NOW, 1), "BRA-2026-0001");
  });

  test("the categories sum to the total, and so do the lines", () => {
    assert.equal(quote.total.amount, 24_958);
    assert.ok(quoteReconciles(quote), "a quote that does not reconcile must never be sent");
  });

  test("a multi-line quote still reconciles", () => {
    const multi = createQuote({
      brand,
      package: pkg,
      lines: [line(), line({ description: "50 stickers", productsTotal: money(4_000, "XOF") })],
      now: NOW,
    });
    assert.ok(quoteReconciles(multi));
    assert.equal(multi.lines.length, 2);
  });

  test("a quote always expires", () => {
    assert.ok(quote.validUntil > quote.createdAt);
    const days = (new Date(quote.validUntil).getTime() - NOW.getTime()) / 86_400_000;
    assert.equal(days, DEFAULT_VALIDITY_DAYS);
  });

  test("an empty quote is refused", () => {
    assert.throws(() => createQuote({ brand, package: pkg, lines: [], now: NOW }), ValidationError);
  });

  test("a line in the wrong currency is refused rather than silently added", () => {
    assert.throws(
      () => createQuote({ brand, package: pkg, lines: [line({ unitPrice: money(500, "USD") })], now: NOW }),
      ValidationError,
    );
  });

  test("a delivery estimate appears only when every line has one (§38)", () => {
    const partial = createQuote({
      brand,
      package: pkg,
      lines: [line({ deliveryEstimate: "12–18 days" }), line()],
      now: NOW,
    });
    assert.equal(partial.deliveryEstimate, undefined, "one silent line means no promise for the order");

    const complete = createQuote({
      brand,
      package: pkg,
      lines: [line({ deliveryEstimate: "12–18 days" })],
      now: NOW,
    });
    assert.equal(complete.deliveryEstimate, "12–18 days");
  });

  test("zero-value categories are not rendered as puzzling empty lines", () => {
    const plain = createQuote({
      brand,
      package: pkg,
      lines: [line({ customizationTotal: money(0, "XOF") })],
      now: NOW,
    });
    const labels = quoteRows(plain).map((r) => r.label);
    assert.ok(!labels.includes("Customisation"));
    assert.equal(labels.at(-1), "Total");
  });

  test("a deposit rounds up and stays inside the total", () => {
    const deposit = depositAmount(quote, 0.5);
    assert.equal(deposit.amount, 12_479);
    assert.ok(deposit.amount <= quote.total.amount);
    assert.throws(() => depositAmount(quote, 1.5), ValidationError);
  });
});

describe("quote status", () => {
  const quote = createQuote({ brand, package: pkg, lines: [line()], now: NOW });

  test("the normal path is draft → sent → approved", () => {
    const sent = transitionQuote(quote, "sent", NOW);
    const approved = transitionQuote(sent, "approved", NOW);
    assert.equal(approved.status, "approved");
  });

  test("a draft cannot be approved without being sent", () => {
    assert.throws(() => transitionQuote(quote, "approved", NOW), ValidationError);
  });

  test("an approved quote is final", () => {
    const approved = transitionQuote(transitionQuote(quote, "sent", NOW), "approved", NOW);
    assert.throws(() => transitionQuote(approved, "sent", NOW), ValidationError);
  });

  test("an expired quote cannot be approved at yesterday's price", () => {
    const sent = transitionQuote(quote, "sent", NOW);
    const later = new Date("2026-04-01T00:00:00Z");
    assert.ok(isExpired(sent, later));
    assert.throws(
      () => transitionQuote(sent, "approved", later),
      (err: unknown) => err instanceof BrandoraError && err.customerMessageKey === "quote.expired",
    );
  });

  test("an expired quote can be reissued", () => {
    const expired = transitionQuote(quote, "expired", NOW);
    assert.equal(transitionQuote(expired, "sent", NOW).status, "sent");
  });
});

/* --- §45, §46 The order lifecycle ---------------------------------------- */

const order = () =>
  createOrder({
    quoteId: "qte_1",
    brandId: "brn_1",
    userId: "usr_1",
    addressId: "adr_1",
    total: money(24_958, "XOF"),
    now: NOW,
  });

const admin = { kind: "admin", userId: "usr_admin" } as const;
const customer = { kind: "customer", userId: "usr_1" } as const;

describe("order lifecycle", () => {
  test("a new order starts as a quote and records why", () => {
    const created = order();
    assert.equal(created.status, "quote");
    assert.equal(created.history.length, 1);
    assert.equal(created.history[0]!.actor, "system:order-created");
  });

  test("the full happy path runs end to end", () => {
    let current = order();
    current = transitionOrder(current, "pending-approval", customer);
    current = transitionOrder(current, "confirmed", customer);
    current = transitionOrder(current, "supplier-processing", admin, { supplierOrderId: "AE-1" });
    current = transitionOrder(current, "shipped", admin, { trackingNumber: "TRK1", carrier: "Test Post" });
    current = transitionOrder(current, "in-transit", admin);
    current = transitionOrder(current, "delivered", admin);

    assert.equal(current.status, "delivered");
    assert.equal(current.history.length, 7);
    assert.equal(current.trackingNumber, "TRK1");
    assert.equal(current.supplierOrderId, "AE-1");
    assert.equal(orderProgress(current), 1);
  });

  test("§45: a customer cannot trigger a supplier purchase", () => {
    let current = order();
    current = transitionOrder(current, "pending-approval", customer);
    current = transitionOrder(current, "confirmed", customer);
    assert.throws(
      () => transitionOrder(current, "supplier-processing", customer, { supplierOrderId: "AE-1" }),
      (err: unknown) => err instanceof ValidationError && /only an admin/.test(err.technicalDetail),
    );
  });

  test("placing a supplier order without recording its id is refused", () => {
    let current = order();
    current = transitionOrder(current, "pending-approval", customer);
    current = transitionOrder(current, "confirmed", customer);
    assert.throws(() => transitionOrder(current, "supplier-processing", admin), ValidationError);
  });

  test("an order cannot be marked shipped with no way for the customer to track it", () => {
    let current = order();
    current = transitionOrder(current, "pending-approval", customer);
    current = transitionOrder(current, "confirmed", customer);
    current = transitionOrder(current, "supplier-processing", admin, { supplierOrderId: "AE-1" });
    assert.throws(
      () => transitionOrder(current, "shipped", admin),
      (err: unknown) => err instanceof ValidationError && /tracking number/.test(err.technicalDetail),
    );
  });

  test("skipping states is impossible", () => {
    assert.throws(() => transitionOrder(order(), "shipped", admin, { trackingNumber: "T" }), ValidationError);
    assert.throws(() => transitionOrder(order(), "delivered", admin), ValidationError);
  });

  test("delivered and cancelled are terminal", () => {
    assert.deepEqual(ORDER_TRANSITIONS.delivered, []);
    assert.deepEqual(ORDER_TRANSITIONS.cancelled, []);
  });

  test("an order stops being cancellable once it has left the supplier", () => {
    let current = order();
    current = transitionOrder(current, "pending-approval", customer);
    current = transitionOrder(current, "confirmed", customer);
    assert.ok(isCancellable(current));
    current = transitionOrder(current, "supplier-processing", admin, { supplierOrderId: "AE-1" });
    current = transitionOrder(current, "shipped", admin, { trackingNumber: "T" });
    assert.equal(isCancellable(current), false);
  });

  test("every transition records who made it", () => {
    const current = transitionOrder(order(), "pending-approval", customer, { note: "quote approved" });
    const event = current.history.at(-1)!;
    assert.equal(event.actor, "customer:usr_1");
    assert.equal(event.note, "quote approved");
  });

  test("a cancelled order reports the progress it had reached", () => {
    let current = order();
    current = transitionOrder(current, "pending-approval", customer);
    current = transitionOrder(current, "confirmed", customer);
    const cancelled = transitionOrder(current, "cancelled", admin);
    assert.ok(orderProgress(cancelled) > 0 && orderProgress(cancelled) < 1);
  });

  test("transitions do not mutate the order they were given", () => {
    const before = order();
    transitionOrder(before, "pending-approval", customer);
    assert.equal(before.status, "quote");
    assert.equal(before.history.length, 1);
  });

  test("§54: each customer-visible state maps to one notification", () => {
    assert.equal(notificationFor("pending-approval"), "notify.quote.ready");
    assert.equal(notificationFor("shipped"), "notify.order.shipped");
    assert.equal(notificationFor("delivered"), "notify.order.delivered");
    assert.equal(notificationFor("quote"), null);
  });
});
