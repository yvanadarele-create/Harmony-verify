import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  type Repositories,
  createRepositories,
  loadProjectBundle,
  openDatabase,
  toBrandProfile,
  transaction,
} from "@brandora/database";

let repos: Repositories;
let db: ReturnType<typeof openDatabase>;

beforeEach(() => {
  db = openDatabase(":memory:");
  repos = createRepositories(db);
});

const makeUser = (email = "founder@example.com") =>
  repos.users.create({ email, name: "Ada Founder" });

/* --- Users ---------------------------------------------------------------- */

describe("users", () => {
  test("an account is created with the customer role by default", () => {
    const user = makeUser();
    assert.equal(user.role, "customer");
    assert.equal(user.currency, "XOF");
    assert.equal(user.locale, "en");
  });

  test("email is stored lowercased and looked up case-insensitively", () => {
    makeUser("Founder@Example.COM");
    const found = repos.users.findByEmail("founder@example.com");
    assert.ok(found);
    assert.equal(found.email, "founder@example.com");
    assert.ok(repos.users.findByEmail("FOUNDER@EXAMPLE.COM"));
  });

  test("two accounts cannot share an address", () => {
    makeUser();
    assert.throws(() => makeUser(), /UNIQUE|constraint/i);
  });

  test("a user row never carries a password hash", () => {
    const user = makeUser();
    repos.users.setCredentials(user.id, "hash", "salt");
    const fetched = repos.users.findById(user.id)!;
    assert.ok(!JSON.stringify(fetched).includes("hash"));
    assert.ok(!("passwordHash" in (fetched as object)));
  });

  test("credentials are fetched only by an explicit, separate call", () => {
    const user = makeUser();
    repos.users.setCredentials(user.id, "the-hash", "the-salt");
    const credentials = repos.users.credentialsFor(user.id)!;
    assert.equal(credentials.passwordHash, "the-hash");
    assert.equal(credentials.passwordSalt, "the-salt");
  });

  test("setting credentials twice replaces rather than duplicates", () => {
    const user = makeUser();
    repos.users.setCredentials(user.id, "old", "salt1");
    repos.users.setCredentials(user.id, "new", "salt2");
    assert.equal(repos.users.credentialsFor(user.id)!.passwordHash, "new");
  });

  test("an unknown role is refused by the database, not just the application", () => {
    assert.throws(
      () => db.prepare(`UPDATE users SET role = 'superuser' WHERE id = ?`).run(makeUser().id),
      /CHECK|constraint/i,
    );
  });
});

/* --- Sessions ------------------------------------------------------------- */

describe("sessions", () => {
  test("a session can be created, found and destroyed", () => {
    const user = makeUser();
    repos.sessions.create(user.id, "token-1", "2099-01-01T00:00:00.000Z");
    assert.equal(repos.sessions.find("token-1")!.userId, user.id);
    repos.sessions.destroy("token-1");
    assert.equal(repos.sessions.find("token-1"), null);
  });

  test("logging out everywhere destroys every session for that user", () => {
    const user = makeUser();
    repos.sessions.create(user.id, "a", "2099-01-01T00:00:00.000Z");
    repos.sessions.create(user.id, "b", "2099-01-01T00:00:00.000Z");
    repos.sessions.destroyAllFor(user.id);
    assert.equal(repos.sessions.find("a"), null);
    assert.equal(repos.sessions.find("b"), null);
  });

  test("expired sessions are purged and live ones are left alone", () => {
    const user = makeUser();
    repos.sessions.create(user.id, "old", "2020-01-01T00:00:00.000Z");
    repos.sessions.create(user.id, "live", "2099-01-01T00:00:00.000Z");
    assert.equal(repos.sessions.purgeExpired("2026-01-01T00:00:00.000Z"), 1);
    assert.equal(repos.sessions.find("old"), null);
    assert.ok(repos.sessions.find("live"));
  });

  test("deleting a user takes their sessions with them", () => {
    const user = makeUser();
    repos.sessions.create(user.id, "t", "2099-01-01T00:00:00.000Z");
    db.prepare(`DELETE FROM users WHERE id = ?`).run(user.id);
    assert.equal(repos.sessions.find("t"), null);
  });
});

/* --- Ownership ------------------------------------------------------------ */

describe("project ownership is part of the query, not a check after it", () => {
  test("the owner finds their project", () => {
    const user = makeUser();
    const project = repos.projects.create(user.id, "Luma");
    assert.ok(repos.projects.findForOwner(project.id, user.id));
  });

  test("another user does not find it — it is absent, not refused", () => {
    const owner = makeUser("owner@example.com");
    const stranger = makeUser("stranger@example.com");
    const project = repos.projects.create(owner.id, "Luma");
    assert.equal(repos.projects.findForOwner(project.id, stranger.id), null);
  });

  test("listing is scoped to the owner", () => {
    const owner = makeUser("owner@example.com");
    const stranger = makeUser("stranger@example.com");
    repos.projects.create(owner.id, "Mine");
    repos.projects.create(stranger.id, "Theirs");
    const listed = repos.projects.listForOwner(owner.id);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.name, "Mine");
  });

  test("a write scoped to the wrong owner changes nothing", () => {
    const owner = makeUser("owner@example.com");
    const stranger = makeUser("stranger@example.com");
    const project = repos.projects.create(owner.id, "Luma");
    repos.projects.rename(project.id, stranger.id, "Hijacked");
    assert.equal(repos.projects.findForOwner(project.id, owner.id)!.name, "Luma");
  });

  test("quotes and orders are scoped the same way", () => {
    const owner = makeUser("owner@example.com");
    const stranger = makeUser("stranger@example.com");
    const project = repos.projects.create(owner.id, "Luma");

    const quote = repos.quotes.create({
      projectId: project.id, userId: owner.id, reference: "BRA-2026-0001",
      currency: "XOF", lineItems: [], subtotal: 15_000, shipping: 6_000,
      fees: 1_900, total: 22_900, margin: 5_400, validUntil: "2099-01-01T00:00:00.000Z",
    });
    assert.equal(repos.quotes.findForOwner(quote.id, stranger.id), null);
    assert.ok(repos.quotes.findForOwner(quote.id, owner.id));

    const order = repos.orders.create({
      userId: owner.id, projectId: project.id, quoteId: quote.id,
      reference: "ORD-1", total: 22_900, currency: "XOF",
    });
    assert.equal(repos.orders.findForOwner(order.id, stranger.id), null);
    assert.ok(repos.orders.findForOwner(order.id, owner.id));
  });

  test("an admin read is a separately named method, impossible to reach by accident", () => {
    const owner = makeUser();
    const project = repos.projects.create(owner.id, "Luma");
    assert.ok(repos.projects.findAsAdmin(project.id));
    assert.equal(repos.projects.listAsAdmin().length, 1);
  });
});

/* --- Margin privacy ------------------------------------------------------- */

describe("§39 margin never reaches a customer-facing read", () => {
  test("the customer's quote object has no margin field at any depth", () => {
    const user = makeUser();
    const project = repos.projects.create(user.id, "Luma");
    const quote = repos.quotes.create({
      projectId: project.id, userId: user.id, reference: "BRA-2026-0002",
      currency: "XOF", lineItems: [{ productId: "p", description: "cups", quantity: 30, unitPrice: 500, total: 15_000 }],
      subtotal: 15_000, shipping: 6_000, fees: 1_900, total: 22_900,
      margin: 5_444, validUntil: "2099-01-01T00:00:00.000Z",
    });

    const customerView = repos.quotes.findForOwner(quote.id, user.id)!;
    assert.ok(!("margin" in (customerView as object)));
    assert.ok(!JSON.stringify(customerView).includes("5444"));

    const adminView = repos.quotes.findAsAdmin(quote.id)!;
    assert.equal(adminView.margin.amount, 5_444, "the admin view does carry it");
  });
});

/* --- Money round-trips ---------------------------------------------------- */

describe("money survives the database", () => {
  test("an XOF amount is stored and read back as the same integer", () => {
    const user = makeUser();
    const project = repos.projects.create(user.id, "Luma");
    const quote = repos.quotes.create({
      projectId: project.id, userId: user.id, reference: "BRA-2026-0003",
      currency: "XOF", lineItems: [], subtotal: 1_500, shipping: 0, fees: 0,
      total: 1_500, margin: 0, validUntil: "2099-01-01T00:00:00.000Z",
    });
    const read = repos.quotes.findForOwner(quote.id, user.id)!;
    assert.deepEqual(read.total, { amount: 1_500, currency: "XOF" });
  });

  test("an amount always comes back with its currency attached", () => {
    const user = repos.users.create({ email: "usd@example.com", name: "U", currency: "USD" });
    const project = repos.projects.create(user.id, "Dollars");
    const quote = repos.quotes.create({
      projectId: project.id, userId: user.id, reference: "BRA-2026-0004",
      currency: "USD", lineItems: [], subtotal: 1_250, shipping: 0, fees: 0,
      total: 1_250, margin: 0, validUntil: "2099-01-01T00:00:00.000Z",
    });
    assert.equal(repos.quotes.findForOwner(quote.id, user.id)!.total.currency, "USD");
  });
});

/* --- Project bundle ------------------------------------------------------- */

describe("the project bundle", () => {
  test("an interview can be saved, resumed and completed", () => {
    const user = makeUser();
    const project = repos.projects.create(user.id, "Luma");

    repos.interviews.save(project.id, { business: "A bakery" }, false);
    let interview = repos.interviews.findForProject(project.id)!;
    assert.equal(interview.completedAt, undefined, "an in-progress interview has no completion");
    assert.deepEqual(interview.responses, { business: "A bakery" });

    repos.interviews.save(project.id, { business: "A bakery", product: "Cookies" }, true);
    interview = repos.interviews.findForProject(project.id)!;
    assert.ok(interview.completedAt);
    assert.equal(Object.keys(interview.responses).length, 2, "saving replaces, never duplicates");
  });

  test("a strategy and identity round-trip into a BrandProfile the engine accepts", () => {
    const user = makeUser();
    const project = repos.projects.create(user.id, "Luma");

    repos.strategies.save(project.id, {
      name: "Luma", description: "A home bakery", industry: "bakery",
      positioning: "premium", targetCustomer: "Young professionals",
      personality: ["elegant", "warm"], promise: "Baked this morning",
      mission: "m", vision: "v", slogan: "Baked this morning.",
      toneOfVoice: "warm", brandStory: "story", nameAlternatives: ["Sablé"],
    }, { echoed: true });

    repos.identities.save(project.id, {
      palette: [{ name: "Primary", hex: "#6D2C47", role: "primary", rationale: "r" }],
      typography: {
        primary: "Playfair Display", secondary: "Inter",
        primaryFallback: "Georgia, serif", secondaryFallback: "system-ui",
        rationale: "r",
      },
      logoBrief: "Minimal geometric mark",
    });

    const bundle = loadProjectBundle(repos, project.id, user.id)!;
    assert.ok(bundle.strategy);
    assert.ok(bundle.identity);
    assert.deepEqual(bundle.strategy.personality, ["elegant", "warm"]);

    const profile = toBrandProfile(bundle)!;
    assert.equal(profile.name, "Luma");
    assert.equal(profile.positioning, "premium");
    assert.equal(profile.palette[0]!.hex, "#6D2C47");
    assert.equal(profile.typography.primary, "Playfair Display");
  });

  test("the bundle is null for someone else's project", () => {
    const owner = makeUser("owner@example.com");
    const stranger = makeUser("stranger@example.com");
    const project = repos.projects.create(owner.id, "Luma");
    assert.equal(loadProjectBundle(repos, project.id, stranger.id), null);
  });

  test("a profile cannot be assembled from a half-generated project", () => {
    const user = makeUser();
    const project = repos.projects.create(user.id, "Luma");
    assert.equal(toBrandProfile(loadProjectBundle(repos, project.id, user.id)!), null);
  });
});

/* --- Orders --------------------------------------------------------------- */

describe("orders", () => {
  const seed = () => {
    const user = makeUser();
    const project = repos.projects.create(user.id, "Luma");
    const quote = repos.quotes.create({
      projectId: project.id, userId: user.id, reference: "BRA-2026-0005",
      currency: "XOF", lineItems: [], subtotal: 15_000, shipping: 6_000,
      fees: 1_900, total: 22_900, margin: 5_400, validUntil: "2099-01-01T00:00:00.000Z",
    });
    return { user, project, quote };
  };

  test("a new order is unpaid and pending — never optimistically paid", () => {
    const { user, project, quote } = seed();
    const order = repos.orders.create({
      userId: user.id, projectId: project.id, quoteId: quote.id,
      reference: "ORD-1", total: 22_900, currency: "XOF",
    });
    assert.equal(order.paymentStatus, "unpaid");
    assert.equal(order.fulfillmentStatus, "pending");
  });

  test("the event log is append-only and ordered", () => {
    const { user, project, quote } = seed();
    const order = repos.orders.create({
      userId: user.id, projectId: project.id, quoteId: quote.id,
      reference: "ORD-2", total: 22_900, currency: "XOF",
    });
    repos.orders.addEvent(order.id, "created", "system");
    repos.orders.addEvent(order.id, "payment-verified", "system:paystack", "ref=abc");
    const events = repos.orders.events(order.id);
    assert.equal(events.length, 2);
    assert.equal(events[0]!.kind, "created");
    assert.equal(events[1]!.detail, "ref=abc");
  });

  test("an order cannot reference a quote that does not exist", () => {
    const user = makeUser();
    const project = repos.projects.create(user.id, "Luma");
    assert.throws(
      () => repos.orders.create({
        userId: user.id, projectId: project.id, quoteId: "qte_missing",
        reference: "ORD-3", total: 1, currency: "XOF",
      }),
      /FOREIGN KEY|constraint/i,
    );
  });

  test("an unknown payment status is refused by the database", () => {
    const { user, project, quote } = seed();
    const order = repos.orders.create({
      userId: user.id, projectId: project.id, quoteId: quote.id,
      reference: "ORD-4", total: 1, currency: "XOF",
    });
    assert.throws(
      () => db.prepare(`UPDATE orders SET payment_status = 'definitely-paid' WHERE id = ?`).run(order.id),
      /CHECK|constraint/i,
    );
  });
});

/* --- Transactions --------------------------------------------------------- */

describe("transactions", () => {
  test("a failure rolls the whole unit of work back", () => {
    const user = makeUser();
    assert.throws(() =>
      transaction(db, () => {
        repos.projects.create(user.id, "Half-written");
        throw new Error("something failed downstream");
      }),
    );
    assert.equal(repos.projects.listForOwner(user.id).length, 0);
  });

  test("a successful transaction commits", () => {
    const user = makeUser();
    transaction(db, () => {
      repos.projects.create(user.id, "Committed");
    });
    assert.equal(repos.projects.listForOwner(user.id).length, 1);
  });
});
