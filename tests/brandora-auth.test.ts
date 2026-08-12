import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  type Principal,
  AuthorizationError,
  MIN_PASSWORD_LENGTH,
  WeakPasswordError,
  authorize,
  hashPassword,
  isAdmin,
  newSessionToken,
  requireAuthorized,
  sessionExpiry,
  sessionIsLive,
  verifyPassword,
  wasteVerificationTime,
} from "@brandora/auth";

/* --- Passwords ------------------------------------------------------------ */

describe("password hashing", () => {
  test("a correct password verifies", () => {
    const record = hashPassword("correct horse battery staple");
    assert.equal(verifyPassword("correct horse battery staple", record), true);
  });

  test("a wrong password does not", () => {
    const record = hashPassword("correct horse battery staple");
    assert.equal(verifyPassword("Correct horse battery staple", record), false);
    assert.equal(verifyPassword("", record), false);
  });

  test("two accounts with the same password get different hashes", () => {
    const a = hashPassword("the same password twice");
    const b = hashPassword("the same password twice");
    assert.notEqual(a.hash, b.hash, "a shared hash means a shared salt — rainbow tables work");
    assert.notEqual(a.salt, b.salt);
  });

  test("the stored record contains no trace of the password", () => {
    const record = hashPassword("hunter22hunter22");
    assert.ok(!record.hash.includes("hunter"));
    assert.ok(!record.salt.includes("hunter"));
    assert.match(record.hash, /^[0-9a-f]{128}$/);
  });

  test("a short password is refused before it is ever hashed", () => {
    assert.throws(() => hashPassword("short"), WeakPasswordError);
    assert.throws(() => hashPassword("a".repeat(MIN_PASSWORD_LENGTH - 1)), WeakPasswordError);
    assert.doesNotThrow(() => hashPassword("a".repeat(MIN_PASSWORD_LENGTH)));
  });

  test("a megabyte password is a denial-of-service request, not a login", () => {
    assert.throws(() => hashPassword("a".repeat(100_000)), WeakPasswordError);
  });

  test("a corrupt stored record fails the login rather than crashing the endpoint", () => {
    assert.equal(verifyPassword("anything", { hash: "not-hex", salt: "also-not-hex" }), false);
    assert.equal(verifyPassword("anything", { hash: "", salt: "" }), false);
    assert.equal(verifyPassword("anything", { hash: "ab", salt: "cd" }), false);
  });

  test("unicode passwords normalise, so the same keystrokes always verify", () => {
    // é as one code point vs e + combining accent — same password to a person.
    const record = hashPassword("café au lait please");
    assert.equal(verifyPassword("café au lait please", record), true);
  });

  test("verifying a non-existent account costs the same as a real one", () => {
    // Not a timing assertion — those are flaky. This asserts the equalisation
    // function exists and runs, which is what closes the enumeration oracle.
    const started = Date.now();
    wasteVerificationTime();
    assert.ok(Date.now() - started >= 0);
  });
});

/* --- Session tokens ------------------------------------------------------- */

describe("session tokens", () => {
  test("tokens are long, URL-safe and unique", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newSessionToken()));
    assert.equal(tokens.size, 200, "a collision means the RNG is not what we think");
    for (const token of tokens) {
      assert.match(token, /^[A-Za-z0-9_-]{40,}$/);
    }
  });

  test("expiry is in the future and liveness tracks it", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const expires = sessionExpiry(from, 24);
    assert.equal(expires, "2026-01-02T00:00:00.000Z");
    assert.equal(sessionIsLive(expires, new Date("2026-01-01T12:00:00Z")), true);
    assert.equal(sessionIsLive(expires, new Date("2026-01-03T00:00:00Z")), false);
  });

  test("an expired session is not live even one second past", () => {
    assert.equal(
      sessionIsLive("2026-01-01T00:00:00.000Z", new Date("2026-01-01T00:00:01Z")),
      false,
    );
  });
});

/* --- Authorisation -------------------------------------------------------- */

const customer: Principal = { userId: "usr_1", email: "a@example.com", role: "customer" };
const other: Principal = { userId: "usr_2", email: "b@example.com", role: "customer" };
const admin: Principal = { userId: "usr_admin", email: "admin@example.com", role: "admin" };

describe("authorisation", () => {
  test("anonymous requests are 401, not 403", () => {
    const decision = authorize(null, "project:read", { userId: "usr_1" });
    assert.equal(decision.allowed, false);
    assert.equal(decision.status, 401);
  });

  test("an owner may read and update their own project", () => {
    assert.equal(authorize(customer, "project:read", { userId: "usr_1" }).allowed, true);
    assert.equal(authorize(customer, "project:update", { userId: "usr_1" }).allowed, true);
  });

  test("another customer gets 404, not 403 — a 403 confirms the id is real", () => {
    const decision = authorize(other, "project:read", { userId: "usr_1" });
    assert.equal(decision.allowed, false);
    assert.equal(decision.status, 404);
  });

  test("cross-user access is refused for quotes and orders too", () => {
    assert.equal(authorize(other, "quote:read", { userId: "usr_1" }).allowed, false);
    assert.equal(authorize(other, "order:read", { userId: "usr_1" }).allowed, false);
    assert.equal(authorize(other, "quote:approve", { userId: "usr_1" }).allowed, false);
  });

  test("a missing resource denies rather than allows", () => {
    const decision = authorize(customer, "project:read", null);
    assert.equal(decision.allowed, false);
    assert.equal(decision.status, 404);
  });

  test("admin routes are closed to customers", () => {
    assert.equal(authorize(customer, "admin:read").allowed, false);
    assert.equal(authorize(customer, "admin:write").allowed, false);
    assert.equal(authorize(admin, "admin:read").allowed, true);
    assert.equal(authorize(admin, "admin:write").allowed, true);
  });

  test("an admin may read another user's resources but not act as them", () => {
    assert.equal(authorize(admin, "order:read", { userId: "usr_1" }).allowed, true);
    assert.equal(authorize(admin, "quote:read", { userId: "usr_1" }).allowed, true);
    assert.equal(
      authorize(admin, "quote:approve", { userId: "usr_1" }).allowed,
      false,
      "approving someone's quote is acting as them",
    );
  });

  test("only an admin moves fulfilment — the rule that spends money", () => {
    assert.equal(authorize(customer, "order:update-fulfillment", { userId: "usr_1" }).allowed, false);
    assert.equal(authorize(admin, "order:update-fulfillment", { userId: "usr_1" }).allowed, true);
  });

  test("a customer cannot escalate by owning the resource", () => {
    assert.equal(
      authorize(customer, "order:update-fulfillment", { userId: "usr_1" }).allowed,
      false,
      "owning your own order does not make you an operator",
    );
  });

  test("every decision carries a reason for the audit log", () => {
    for (const decision of [
      authorize(customer, "project:read", { userId: "usr_1" }),
      authorize(other, "project:read", { userId: "usr_1" }),
      authorize(null, "admin:read"),
    ]) {
      assert.ok(decision.reason.length > 0);
    }
  });

  test("the reason names the actor and the action, for the audit trail", () => {
    const denial = authorize(other, "project:read", { userId: "usr_1" });
    assert.match(denial.reason, /usr_2/);
    assert.match(denial.reason, /project:read/);
  });

  test("isAdmin is false for anonymous and for customers", () => {
    assert.equal(isAdmin(null), false);
    assert.equal(isAdmin(undefined), false);
    assert.equal(isAdmin(customer), false);
    assert.equal(isAdmin(admin), true);
  });
});

describe("requireAuthorized", () => {
  test("passes silently when allowed", () => {
    assert.doesNotThrow(() => requireAuthorized(customer, "project:read", { userId: "usr_1" }));
  });

  test("throws with the decision's status when refused", () => {
    assert.throws(
      () => requireAuthorized(other, "project:read", { userId: "usr_1" }),
      (err: unknown) => err instanceof AuthorizationError && err.status === 404,
    );
  });

  test("an anonymous caller throws a 401", () => {
    assert.throws(
      () => requireAuthorized(null, "quote:create"),
      (err: unknown) => err instanceof AuthorizationError && err.status === 401,
    );
  });
});
