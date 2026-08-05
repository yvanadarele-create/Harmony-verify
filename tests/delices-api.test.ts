/**
 * The HTTP surface, exercised over a real socket: what the public may do, what the
 * admin may do, and what neither may do.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { createApp } from "@delices/server";
import {
  createOption,
  createProduct,
  createUser,
  getCategoryBySlug,
  openDatabase,
  seedBaseline,
  type Db,
} from "@delices/db";

let base = "";
let db: Db;
let uploadDir = "";
let server: ReturnType<typeof createApp>["server"];
let productId = "";
let sizeId = "";

const OWNER = { name: "Grace", email: "grace@example.com", password: "motdepasse-2026" };

before(async () => {
  uploadDir = mkdtempSync(join(tmpdir(), "delices-uploads-"));
  db = openDatabase(":memory:");
  seedBaseline(db);
  createUser(db, { ...OWNER, role: "owner" });

  const category = getCategoryBySlug(db, "pizzas")!;
  const product = createProduct(db, {
    categoryId: category.id,
    name: "Pizza Margherita",
    basePrice: 1000,
  });
  productId = product.id;
  sizeId = createOption(db, {
    productId: product.id,
    kind: "size",
    groupLabel: "Taille",
    label: "Grande",
    priceDelta: 400,
    required: true,
  }).id;

  const app = createApp({ db, webRoot: fileURLToPath(new URL("../../apps/delices", import.meta.url)), uploadDir });
  server = app.server;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  rmSync(uploadDir, { recursive: true, force: true });
});

const json = (path: string, method: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

function futureDate(days = 20): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

test("the catalogue is readable without any credentials", async () => {
  const products = (await (await fetch(base + "/api/products")).json()) as Array<{
    name: string;
    options: unknown[];
  }>;
  assert.equal(products.length, 1);
  assert.equal(products[0]!.name, "Pizza Margherita");
  assert.equal(products[0]!.options.length, 1);

  const options = (await (await fetch(base + "/api/options")).json()) as Record<string, unknown[]>;
  assert.ok(options.occasion!.length > 0, "the brief's choices are public");
});

test("a well-formed order is accepted and answered with a reference", async () => {
  const response = await json("/api/orders", "POST", {
    customer: { name: "Awa Diop", phone: "0612345678", email: "awa@example.com" },
    items: [{ productId, quantity: 2, selectedOptionIds: [sizeId] }],
    requestedDate: futureDate(),
    fulfillment: "pickup",
  });
  assert.equal(response.status, 201);
  const payload = (await response.json()) as { reference: string; message: string };
  assert.match(payload.reference, /^GL-\d{6}-[A-Z2-9]{4}$/);
  assert.match(payload.message, /Merci pour votre demande/);
});

test("an invalid order comes back with per-field messages, not a stack trace", async () => {
  const response = await json("/api/orders", "POST", {
    customer: { name: "", phone: "" },
    items: [],
    requestedDate: "2020-01-01",
    fulfillment: "pickup",
  });
  assert.equal(response.status, 400);
  const payload = (await response.json()) as { errors: Array<{ field: string; message: string }> };
  assert.ok(payload.errors.length >= 3);
  for (const error of payload.errors) assert.ok(/[a-zàâçéèêëîïôûùüÿñæœ]/i.test(error.message));
});

test("the browser cannot dictate a price", async () => {
  const response = await json("/api/orders", "POST", {
    customer: { name: "Awa", phone: "0612345679" },
    items: [{ productId, quantity: 1, selectedOptionIds: [sizeId], unitPrice: 1 }],
    requestedDate: futureDate(),
    fulfillment: "pickup",
    itemsTotal: 1,
  });
  assert.equal(response.status, 201);
  const row = db
    .prepare("SELECT items_total FROM orders ORDER BY created_at DESC LIMIT 1")
    .get() as { items_total: number };
  assert.equal(row.items_total, 1400);
});

test("a custom brief is accepted and stays unpriced", async () => {
  const response = await json("/api/custom-requests", "POST", {
    customer: { name: "Marie L.", phone: "0698765432" },
    occasion: "Mariage",
    requestedDate: futureDate(60),
    servings: 80,
    fulfillment: "delivery",
    address: "12 rue des Lilas",
  });
  assert.equal(response.status, 201);
  const row = db
    .prepare("SELECT quoted_total, kind FROM orders WHERE kind = 'custom' LIMIT 1")
    .get() as { quoted_total: number | null; kind: string };
  assert.equal(row.quoted_total, null);
});

test("tracking requires the matching phone number", async () => {
  const created = await json("/api/orders", "POST", {
    customer: { name: "Awa", phone: "0655555555" },
    items: [{ productId, quantity: 1, selectedOptionIds: [sizeId] }],
    requestedDate: futureDate(),
    fulfillment: "pickup",
  });
  const { reference } = (await created.json()) as { reference: string };

  const wrong = await json("/api/track", "POST", { reference, phone: "0600000000" });
  assert.equal(wrong.status, 404);

  const right = await json("/api/track", "POST", { reference, phone: "0655555555" });
  assert.equal(right.status, 200);
  const payload = (await right.json()) as Record<string, unknown>;
  assert.equal(payload.reference, reference);
  assert.ok(!("internalNotes" in payload), "internal notes never leave the admin");
  assert.ok(!("customer" in payload), "the tracking view carries no personal details");
});

test("uploads accept images and reject anything else", async () => {
  const boundary = "----delicestest";
  function multipart(bytes: Buffer, filename: string): Buffer {
    return Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
  }
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

  const good = await fetch(base + "/api/uploads", {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: multipart(png, "photo.png"),
  });
  assert.equal(good.status, 201);
  const asset = (await good.json()) as { url: string };
  assert.match(asset.url, /^\/uploads\/[a-f0-9]{24}\.png$/);
  assert.equal((await fetch(base + asset.url)).status, 200);

  // A text file renamed .png does not become an image.
  const bad = await fetch(base + "/api/uploads", {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: multipart(Buffer.from("<script>alert(1)</script>"), "evil.png"),
  });
  assert.equal(bad.status, 415);
});

test("the admin is closed to anonymous callers", async () => {
  for (const path of ["/api/admin/orders", "/api/admin/customers", "/api/admin/settings"]) {
    assert.equal((await fetch(base + path)).status, 401, path);
  }
});

test("bad credentials are refused and good ones open a session", async () => {
  const bad = await json("/api/admin/login", "POST", { email: OWNER.email, password: "nope" });
  assert.equal(bad.status, 401);

  const good = await json("/api/admin/login", "POST", {
    email: OWNER.email,
    password: OWNER.password,
  });
  assert.equal(good.status, 200);
  const cookie = good.headers.get("set-cookie") ?? "";
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
});

test("an authenticated admin can review, quote and advance an order", async () => {
  const login = await json("/api/admin/login", "POST", {
    email: OWNER.email,
    password: OWNER.password,
  });
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;
  const auth = { Cookie: cookie, "X-Delices-Admin": "1" };

  const orders = (await (
    await fetch(base + "/api/admin/orders", { headers: { Cookie: cookie } })
  ).json()) as Array<{ id: string; status: string }>;
  assert.ok(orders.length > 0);
  const target = orders[0]!;

  // A mutation without the header is refused even with a valid session.
  const noHeader = await json(
    `/api/admin/orders/${target.id}/status`,
    "POST",
    { status: "REVIEWING" },
    { Cookie: cookie },
  );
  assert.equal(noHeader.status, 403);

  const illegal = await json(
    `/api/admin/orders/${target.id}/status`,
    "POST",
    { status: "COMPLETED" },
    auth,
  );
  assert.equal(illegal.status, 409);

  const legal = await json(
    `/api/admin/orders/${target.id}/status`,
    "POST",
    { status: "REVIEWING" },
    auth,
  );
  assert.equal(legal.status, 200);

  const quoted = await json(
    `/api/admin/orders/${target.id}`,
    "PATCH",
    { quotedTotal: 4200, paymentStatus: "DEPOSIT_PAID", depositPaid: 1000 },
    auth,
  );
  const order = (await quoted.json()) as { quotedTotal: number; paymentStatus: string };
  assert.equal(order.quotedTotal, 4200);
  assert.equal(order.paymentStatus, "DEPOSIT_PAID");

  const dashboard = (await (
    await fetch(base + "/api/admin/dashboard", { headers: { Cookie: cookie } })
  ).json()) as { stats: { pendingRequests: number } };
  assert.ok(dashboard.stats.pendingRequests >= 1);
});

test("logging out ends the session", async () => {
  const login = await json("/api/admin/login", "POST", {
    email: OWNER.email,
    password: OWNER.password,
  });
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;
  await fetch(base + "/api/admin/logout", {
    method: "POST",
    headers: { Cookie: cookie, "X-Delices-Admin": "1" },
  });
  const after = await fetch(base + "/api/admin/orders", { headers: { Cookie: cookie } });
  assert.equal(after.status, 401);
});

test("the static site is served, with clean URLs and a 404 page", async () => {
  assert.equal((await fetch(base + "/")).status, 200);
  assert.equal((await fetch(base + "/sur-mesure")).status, 200);
  const missing = await fetch(base + "/page-qui-nexiste-pas");
  assert.equal(missing.status, 404);
});

test("path traversal does not escape the web root", async () => {
  for (const path of ["/../package.json", "/assets/../../package.json", "/uploads/../../package.json"]) {
    const response = await fetch(base + path);
    assert.ok(response.status === 404 || response.status === 400, path);
    const body = await response.text();
    assert.ok(!body.includes("\"devDependencies\""), path);
  }
});

test("build metadata inside the web root is not site content", async () => {
  for (const path of ["/package.json", "/turbo.json", "/.git/config"]) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
});

test("an oversized JSON body is rejected before it is parsed", async () => {
  const response = await fetch(base + "/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customerNotes: "x".repeat(200_000) }),
  });
  assert.equal(response.status, 413);
});

test("malformed JSON produces a clean error", async () => {
  const response = await fetch(base + "/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ not json",
  });
  assert.equal(response.status, 400);
});
