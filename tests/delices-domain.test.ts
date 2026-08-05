/**
 * Domain rules for Les Délices de Grace Lumière: the order lifecycle, the validation
 * that guards every public form, and money handling across currencies.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ORDER_STATUSES,
  canTransition,
  customerFacingStatus,
  formatMoney,
  isOrderStatus,
  isTerminal,
  nextStatuses,
  orderReference,
  parseAmount,
  slugify,
  validateAppointment,
  validateCustomRequest,
  validateOrderDraft,
} from "@delices/core";

const TODAY = "2026-08-05";

test("the lifecycle covers every specified status", () => {
  assert.equal(ORDER_STATUSES.length, 10);
  for (const status of ORDER_STATUSES) assert.ok(isOrderStatus(status));
  assert.ok(!isOrderStatus("SHIPPED"));
});

test("an order walks the happy path and stops when it is finished", () => {
  const path = [
    "NEW",
    "REVIEWING",
    "QUOTE_SENT",
    "CONFIRMED",
    "DEPOSIT_PAID",
    "IN_PRODUCTION",
    "READY",
    "OUT_FOR_DELIVERY",
    "COMPLETED",
  ] as const;
  for (let i = 0; i < path.length - 1; i++) {
    assert.ok(canTransition(path[i]!, path[i + 1]!), `${path[i]} → ${path[i + 1]}`);
  }
  assert.ok(isTerminal("COMPLETED"));
  assert.ok(isTerminal("CANCELLED"));
  assert.equal(nextStatuses("COMPLETED").length, 0);
});

test("shortcuts Grace actually needs are allowed, nonsense is not", () => {
  // A deposit is optional, and a collected order can complete without a delivery leg.
  assert.ok(canTransition("CONFIRMED", "IN_PRODUCTION"));
  assert.ok(canTransition("READY", "COMPLETED"));
  // Skipping straight from a new request to production is not.
  assert.ok(!canTransition("NEW", "IN_PRODUCTION"));
  assert.ok(!canTransition("COMPLETED", "IN_PRODUCTION"));
  assert.ok(!canTransition("CANCELLED", "NEW"));
});

test("anything open can be cancelled", () => {
  for (const status of ORDER_STATUSES) {
    if (status === "COMPLETED" || status === "CANCELLED") continue;
    assert.ok(canTransition(status, "CANCELLED"), status);
  }
});

test("the customer sees a coarser status than the kitchen", () => {
  assert.equal(customerFacingStatus("NEW"), customerFacingStatus("REVIEWING"));
  assert.match(customerFacingStatus("IN_PRODUCTION"), /préparation/);
});

test("a valid standard order passes", () => {
  const result = validateOrderDraft(
    {
      customer: { name: "Awa Diop", phone: "+33 6 12 34 56 78", email: "awa@example.com" },
      items: [{ productId: "prd_1", quantity: 2, selectedOptionIds: [] }],
      requestedDate: "2026-09-01",
      fulfillment: "pickup",
    },
    TODAY,
  );
  assert.deepEqual(result.errors, []);
  assert.ok(result.ok);
});

test("an order in the past, without a name and without an address is rejected once per problem", () => {
  const result = validateOrderDraft(
    {
      customer: { name: "", phone: "abc" },
      items: [{ productId: "prd_1", quantity: 0, selectedOptionIds: [] }],
      requestedDate: "2020-01-01",
      fulfillment: "delivery",
    },
    TODAY,
  );
  assert.ok(!result.ok);
  const fields = result.errors.map((error) => error.field);
  assert.ok(fields.includes("customer.name"));
  assert.ok(fields.includes("customer.phone"));
  assert.ok(fields.includes("requestedDate"));
  assert.ok(fields.includes("address"));
  assert.ok(fields.includes("items[0].quantity"));
  for (const error of result.errors) assert.ok(error.message.length > 0);
});

test("an empty basket cannot be submitted", () => {
  const result = validateOrderDraft(
    {
      customer: { name: "Awa", phone: "0612345678" },
      items: [],
      requestedDate: "2026-09-01",
      fulfillment: "pickup",
    },
    TODAY,
  );
  assert.ok(result.errors.some((error) => error.field === "items"));
});

test("today counts as a valid requested date", () => {
  const result = validateOrderDraft(
    {
      customer: { name: "Awa", phone: "0612345678" },
      items: [{ productId: "prd_1", quantity: 1, selectedOptionIds: [] }],
      requestedDate: TODAY,
      fulfillment: "pickup",
    },
    TODAY,
  );
  assert.ok(result.ok);
});

test("a date that does not exist is refused", () => {
  const result = validateOrderDraft(
    {
      customer: { name: "Awa", phone: "0612345678" },
      items: [{ productId: "prd_1", quantity: 1, selectedOptionIds: [] }],
      requestedDate: "2026-02-31",
      fulfillment: "pickup",
    },
    TODAY,
  );
  assert.ok(result.errors.some((error) => error.field === "requestedDate"));
});

test("a custom brief needs an occasion and a plausible number of servings", () => {
  const missing = validateCustomRequest(
    {
      customer: { name: "Marie", phone: "0698765432" },
      occasion: "",
      requestedDate: "2026-10-12",
      servings: 99999,
      fulfillment: "pickup",
    },
    TODAY,
  );
  assert.ok(missing.errors.some((error) => error.field === "occasion"));
  assert.ok(missing.errors.some((error) => error.field === "servings"));

  const good = validateCustomRequest(
    {
      customer: { name: "Marie", phone: "0698765432" },
      occasion: "Mariage",
      requestedDate: "2026-10-12",
      servings: 80,
      fulfillment: "delivery",
      address: "12 rue des Lilas",
    },
    TODAY,
  );
  assert.ok(good.ok);
});

test("appointment fields are validated without the customer prefix", () => {
  const result = validateAppointment(
    { name: "P", phone: "", reason: "", preferredTime: "25:00" },
    TODAY,
  );
  const fields = result.errors.map((error) => error.field);
  assert.ok(fields.includes("name"));
  assert.ok(fields.includes("phone"));
  assert.ok(fields.includes("reason"));
  assert.ok(fields.includes("preferredTime"));
  assert.ok(!fields.some((field) => field.startsWith(".")));
});

test("money round-trips in a currency with cents and in one without", () => {
  assert.equal(parseAmount("12,50", "EUR"), 1250);
  assert.equal(parseAmount("12.50", "EUR"), 1250);
  assert.equal(parseAmount("15000", "XAF"), 15000);
  assert.equal(parseAmount("abc", "EUR"), null);
  assert.match(formatMoney(1250, "EUR", "fr-FR"), /12,50/);
  assert.match(formatMoney(15000, "XAF", "fr-FR"), /15\s?000/);
});

test("references are readable, unique-ish and free of confusable characters", () => {
  const reference = orderReference(new Date("2026-08-05T10:00:00Z"));
  assert.match(reference, /^GL-260805-[A-Z2-9]{4}$/);
  assert.ok(!/[OI01]/.test(reference.slice(10)));
  const many = new Set(Array.from({ length: 500 }, () => orderReference()));
  assert.ok(many.size > 490, "references should rarely collide");
});

test("slugs survive accents and punctuation", () => {
  assert.equal(slugify("Gâteau d'anniversaire personnalisé"), "gateau-d-anniversaire-personnalise");
  assert.equal(slugify("Quiche  Lorraine !"), "quiche-lorraine");
  assert.ok(slugify("!!!").length > 0);
});
