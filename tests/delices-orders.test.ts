/**
 * The database layer: pricing resolved from the catalogue, customer identity, the
 * order lifecycle as it is actually persisted, and the views the dashboard reads.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calendar,
  countLowStock,
  createCategory,
  createCustomOrder,
  createInventoryItem,
  createOption,
  createProduct,
  createStandardOrder,
  createTestimonial,
  dashboardStats,
  findOrderForTracking,
  getCategoryBySlug,
  getCustomerSummary,
  getOrder,
  getPublicSettings,
  listCustomers,
  listGlobalOptions,
  listOrders,
  listProducts,
  listTestimonials,
  openDatabase,
  seedBaseline,
  setSettings,
  updateOrderStatus,
  upsertCustomer,
  type Db,
} from "@delices/db";

function fixture(): Db {
  const db = openDatabase(":memory:");
  seedBaseline(db);
  return db;
}

function pizza(db: Db): { productId: string; sizeId: string } {
  const category = getCategoryBySlug(db, "pizzas")!;
  const product = createProduct(db, {
    categoryId: category.id,
    name: "Pizza Margherita",
    basePrice: 1000,
  });
  const size = createOption(db, {
    productId: product.id,
    kind: "size",
    groupLabel: "Taille",
    label: "Grande",
    priceDelta: 400,
    required: true,
  });
  return { productId: product.id, sizeId: size.id };
}

const customer = { name: "Awa Diop", phone: "+33 6 12 34 56 78", email: "awa@example.com" };

test("the baseline seed is idempotent and never duplicates a choice", () => {
  const db = fixture();
  const first = listGlobalOptions(db).length;
  seedBaseline(db);
  assert.equal(listGlobalOptions(db).length, first);
  assert.equal(getCategoryBySlug(db, "gateaux")!.kind, "both");
  assert.ok(first > 20, "the brief's choice lists should be seeded");
});

test("the seed never invents a testimonial", () => {
  const db = fixture();
  assert.deepEqual(listTestimonials(db), []);
});

test("categories are data, so a new one needs no code", () => {
  const db = fixture();
  const category = createCategory(db, { name: "Plateaux salés", kind: "standard" });
  assert.equal(category.slug, "plateaux-sales");
  createProduct(db, { categoryId: category.id, name: "Plateau apéritif", basePrice: 2500 });
  assert.equal(listProducts(db, { categorySlug: "plateaux-sales" }).length, 1);
});

test("a standard order is priced from the catalogue, not from the browser", () => {
  const db = fixture();
  const { productId, sizeId } = pizza(db);
  const result = createStandardOrder(db, {
    customer,
    items: [{ productId, quantity: 2, selectedOptionIds: [sizeId] }],
    requestedDate: "2026-09-01",
    fulfillment: "pickup",
  });
  assert.ok(result.ok);
  const order = result.order;
  assert.equal(order.status, "NEW");
  assert.equal(order.kind, "standard");
  // (1000 base + 400 for the large) × 2
  assert.equal(order.itemsTotal, 2800);
  assert.equal(order.items![0]!.unitPrice, 1400);
  assert.equal(order.quotedTotal, null, "nothing is priced as final until Grace says so");
  assert.equal(order.events!.length, 1);
});

test("an option belonging to another product is refused", () => {
  const db = fixture();
  const { productId } = pizza(db);
  const other = pizza(db);
  const result = createStandardOrder(db, {
    customer,
    items: [{ productId, quantity: 1, selectedOptionIds: [other.sizeId] }],
    requestedDate: "2026-09-01",
    fulfillment: "pickup",
  });
  assert.ok(!result.ok);
  assert.match(result.errors[0]!.message, /Option/);
});

test("a required choice cannot be skipped", () => {
  const db = fixture();
  const { productId } = pizza(db);
  const result = createStandardOrder(db, {
    customer,
    items: [{ productId, quantity: 1, selectedOptionIds: [] }],
    requestedDate: "2026-09-01",
    fulfillment: "pickup",
  });
  assert.ok(!result.ok);
  assert.match(result.errors[0]!.message, /Taille/);
});

test("an unavailable product cannot be ordered", () => {
  const db = fixture();
  const category = getCategoryBySlug(db, "quiches")!;
  const product = createProduct(db, {
    categoryId: category.id,
    name: "Quiche du jour",
    basePrice: 1400,
    available: false,
  });
  const result = createStandardOrder(db, {
    customer,
    items: [{ productId: product.id, quantity: 1, selectedOptionIds: [] }],
    requestedDate: "2026-09-01",
    fulfillment: "pickup",
  });
  assert.ok(!result.ok);
});

test("a quote-only product is accepted and simply carries no price", () => {
  const db = fixture();
  const category = getCategoryBySlug(db, "gateaux")!;
  const product = createProduct(db, {
    categoryId: category.id,
    name: "Wedding cake",
    basePrice: null,
  });
  const result = createStandardOrder(db, {
    customer,
    items: [{ productId: product.id, quantity: 1, selectedOptionIds: [] }],
    requestedDate: "2026-09-01",
    fulfillment: "pickup",
  });
  assert.ok(result.ok);
  assert.equal(result.order.itemsTotal, 0);
  assert.equal(result.order.items![0]!.unitPrice, null);
});

test("a custom brief is stored whole and stays unpriced", () => {
  const db = fixture();
  const result = createCustomOrder(db, {
    customer: { name: "Marie L.", phone: "0698765432" },
    occasion: "Mariage",
    requestedDate: "2026-10-12",
    servings: 80,
    shape: "Plusieurs étages",
    flavour: "Vanille",
    filling: "Ganache chocolat",
    colours: "blanc et rose poudré",
    decoration: "Fleurs fraîches",
    messageOnCake: "Marie & Paul",
    requirements: "Sans arachides.",
    fulfillment: "delivery",
    address: "12 rue des Lilas",
  });
  assert.ok(result.ok);
  const brief = result.order.customRequest!;
  assert.equal(result.order.kind, "custom");
  assert.equal(result.order.quotedTotal, null);
  assert.equal(brief.occasion, "Mariage");
  assert.equal(brief.servings, 80);
  assert.equal(brief.requirements, "Sans arachides.");
});

test("one phone number is one customer, however it is typed", () => {
  const db = fixture();
  const { productId, sizeId } = pizza(db);
  const draft = {
    items: [{ productId, quantity: 1, selectedOptionIds: [sizeId] }],
    requestedDate: "2026-09-01",
    fulfillment: "pickup" as const,
  };
  createStandardOrder(db, { ...draft, customer: { name: "Awa", phone: "+33 6 12 34 56 78" } });
  createStandardOrder(db, { ...draft, customer: { name: "Awa Diop", phone: "0033612345678" } });
  createStandardOrder(db, { ...draft, customer: { name: "Awa Diop", phone: "+33612345678" } });

  const customers = listCustomers(db);
  assert.equal(customers.length, 1, "the three spellings of one number are one customer");
  assert.equal(customers[0]!.totalOrders, 3);
});

test("a curated customer note survives a new order", () => {
  const db = fixture();
  const created = upsertCustomer(db, { name: "Awa", phone: "0612345678" });
  db.prepare("UPDATE customers SET notes = ? WHERE id = ?").run("Cliente fidèle", created.id);
  upsertCustomer(db, { name: "Awa Diop", phone: "0612345678", email: "awa@example.com" });
  const after = getCustomerSummary(db, created.id)!;
  assert.equal(after.notes, "Cliente fidèle");
  assert.equal(after.email, "awa@example.com");
  assert.equal(after.name, "Awa Diop");
});

test("the lifecycle is enforced when it is persisted", () => {
  const db = fixture();
  const { productId, sizeId } = pizza(db);
  const order = (
    createStandardOrder(db, {
      customer,
      items: [{ productId, quantity: 1, selectedOptionIds: [sizeId] }],
      requestedDate: "2026-09-01",
      fulfillment: "pickup",
    }) as { ok: true; order: { id: string } }
  ).order;

  const jump = updateOrderStatus(db, order.id, "READY");
  assert.ok(!jump.ok);

  assert.ok(updateOrderStatus(db, order.id, "CONFIRMED").ok);
  assert.ok(updateOrderStatus(db, order.id, "IN_PRODUCTION").ok);
  const ready = updateOrderStatus(db, order.id, "READY");
  assert.ok(ready.ok);
  assert.equal(ready.order.status, "READY");
  // Every move leaves a trace: creation plus three transitions.
  assert.equal(getOrder(db, order.id)!.events!.length, 4);
});

test("tracking needs both the reference and the phone that placed the order", () => {
  const db = fixture();
  const { productId, sizeId } = pizza(db);
  const order = (
    createStandardOrder(db, {
      customer,
      items: [{ productId, quantity: 1, selectedOptionIds: [sizeId] }],
      requestedDate: "2026-09-01",
      fulfillment: "pickup",
    }) as { ok: true; order: { reference: string } }
  ).order;

  assert.ok(findOrderForTracking(db, order.reference, "0612345678"));
  assert.ok(findOrderForTracking(db, order.reference.toLowerCase(), "+33 6 12 34 56 78"));
  assert.equal(findOrderForTracking(db, order.reference, "0700000000"), null);
  assert.equal(findOrderForTracking(db, "GL-000000-XXXX", "0612345678"), null);
});

test("the calendar counts the load per day and ignores cancellations", () => {
  const db = fixture();
  const { productId, sizeId } = pizza(db);
  const place = (date: string) =>
    createStandardOrder(db, {
      customer,
      items: [{ productId, quantity: 3, selectedOptionIds: [sizeId] }],
      requestedDate: date,
      fulfillment: "pickup",
    }) as { ok: true; order: { id: string } };

  place("2026-09-01");
  place("2026-09-01");
  const cancelled = place("2026-09-02");
  updateOrderStatus(db, cancelled.order.id, "CANCELLED");

  const days = calendar(db, "2026-09-01", "2026-09-30");
  assert.equal(days.length, 1);
  assert.equal(days[0]!.date, "2026-09-01");
  assert.equal(days[0]!.orders, 2);
  assert.equal(days[0]!.items, 6);
});

test("the dashboard counts what Grace needs to act on, and revenue follows the quote", () => {
  const db = fixture();
  const { productId, sizeId } = pizza(db);
  const order = (
    createStandardOrder(db, {
      customer,
      items: [{ productId, quantity: 1, selectedOptionIds: [sizeId] }],
      requestedDate: "2026-08-05",
      fulfillment: "delivery",
      address: "12 rue des Lilas",
    }) as { ok: true; order: { id: string } }
  ).order;

  let stats = dashboardStats(db, "2026-08-05");
  assert.equal(stats.ordersToday, 1);
  assert.equal(stats.pendingRequests, 1);
  assert.equal(stats.deliveriesToday, 1);
  assert.equal(stats.revenueThisMonth, 0);

  db.prepare("UPDATE orders SET quoted_total = 5000 WHERE id = ?").run(order.id);
  updateOrderStatus(db, order.id, "CONFIRMED");
  updateOrderStatus(db, order.id, "IN_PRODUCTION");
  updateOrderStatus(db, order.id, "READY");
  updateOrderStatus(db, order.id, "COMPLETED");

  stats = dashboardStats(db, "2026-08-05");
  assert.equal(stats.completedThisMonth, 1);
  assert.equal(stats.revenueThisMonth, 5000, "the confirmed quote is what was earned");
  assert.equal(getCustomerSummary(db, listCustomers(db)[0]!.id)!.totalSpend, 5000);
});

test("stock alerts fire at the minimum, not below it", () => {
  const db = fixture();
  createInventoryItem(db, { name: "Farine", quantity: 12, unit: "kg", minimumStock: 5 });
  createInventoryItem(db, { name: "Beurre", quantity: 5, unit: "kg", minimumStock: 5 });
  createInventoryItem(db, { name: "Chocolat", quantity: 1, unit: "kg", minimumStock: 3 });
  assert.equal(countLowStock(db), 2);
  assert.equal(dashboardStats(db, "2026-08-05").lowStock, 2);
});

test("a testimonial is invisible until it is published", () => {
  const db = fixture();
  createTestimonial(db, { customerName: "Client", body: "Merci !" });
  assert.equal(listTestimonials(db, { publishedOnly: true }).length, 0);
  assert.equal(listTestimonials(db).length, 1);
});

test("the public settings never expose the owner's notification address", () => {
  const db = fixture();
  setSettings(db, { ownerNotificationEmail: "prive@example.com", phone: "+33 1 23 45 67 89" });
  const settings = getPublicSettings(db) as unknown as Record<string, unknown>;
  assert.equal(settings.phone, "+33 1 23 45 67 89");
  assert.ok(!Object.values(settings).includes("prive@example.com"));
});

test("orders can be filtered the way the admin filters them", () => {
  const db = fixture();
  const { productId, sizeId } = pizza(db);
  createStandardOrder(db, {
    customer,
    items: [{ productId, quantity: 1, selectedOptionIds: [sizeId] }],
    requestedDate: "2026-09-01",
    fulfillment: "pickup",
  });
  createCustomOrder(db, {
    customer: { name: "Marie", phone: "0698765432" },
    occasion: "Mariage",
    requestedDate: "2026-10-12",
    fulfillment: "pickup",
  });

  assert.equal(listOrders(db, { kind: "custom" }).length, 1);
  assert.equal(listOrders(db, { statuses: ["NEW"] }).length, 2);
  assert.equal(listOrders(db, { from: "2026-10-01" }).length, 1);
  assert.equal(listOrders(db, { search: "Marie" }).length, 1);
  assert.equal(listOrders(db, { search: "0698765432" }).length, 1);
});
