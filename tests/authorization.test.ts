import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  areaForPath,
  authorize,
  canEnterArea,
  canReadReview,
  canReadSubmission,
  canReadWallet,
  canWritePayoutDetails,
  canWriteReview,
  shouldBeAdmin,
  type Principal,
} from "@harmony/auth";
import { adminEmail, isAdminEmail, redact, DEFAULT_ADMIN_EMAIL, MissingConfigError, paystackSecretKey } from "@harmony/config";

/* --- Principals ----------------------------------------------------------- */

const customer: Principal = { userId: "u-cust", email: "ops@customer.example", role: "customer" };

const expert: Principal = {
  userId: "u-exp",
  email: "dr@hospital.example",
  role: "expert",
  expertId: "e-1",
  agreementSigned: true,
};

const unsignedExpert: Principal = { ...expert, agreementSigned: false };
const otherExpert: Principal = { ...expert, userId: "u-exp-2", expertId: "e-2" };
const admin: Principal = { userId: "u-admin", email: DEFAULT_ADMIN_EMAIL, role: "admin" };

/* --- Admin identity ------------------------------------------------------- */

describe("the admin account", () => {
  test("defaults to the founder's address", () => {
    assert.equal(adminEmail({}), DEFAULT_ADMIN_EMAIL);
    assert.equal(shouldBeAdmin(DEFAULT_ADMIN_EMAIL), true);
  });

  test("matching ignores capitalisation and surrounding space", () => {
    assert.equal(isAdminEmail(" YvanaDarele@Gmail.com "), true);
    assert.equal(isAdminEmail("yvanadarele@gmail.com"), true);
  });

  test("nobody else is admin", () => {
    assert.equal(isAdminEmail("someone@else.example"), false);
    assert.equal(isAdminEmail(""), false);
    assert.equal(isAdminEmail(null), false);
    assert.equal(isAdminEmail("yvanadarele@gmail.com.attacker.example"), false);
  });

  test("the environment can move it", () => {
    assert.equal(adminEmail({ ADMIN_EMAIL: "ops@harmonyverify.com" }), "ops@harmonyverify.com");
  });
});

/* --- The expert portal is private ----------------------------------------- */

describe("the expert portal is private", () => {
  test("an anonymous visitor is asked to sign in", () => {
    const decision = canEnterArea(null, "expert");
    assert.equal(decision.allowed, false);
    assert.equal(decision.status, 401);
  });

  test("a customer cannot enter, and is not told it exists", () => {
    const decision = canEnterArea(customer, "expert");
    assert.equal(decision.allowed, false);
    assert.equal(decision.status, 404);
  });

  test("an expert enters their own portal", () => {
    assert.equal(canEnterArea(expert, "expert").allowed, true);
  });

  test("an expert account with no linked profile cannot", () => {
    const orphan: Principal = { ...expert, expertId: null };
    assert.equal(canEnterArea(orphan, "expert").allowed, false);
  });

  test("an admin has oversight", () => {
    assert.equal(canEnterArea(admin, "expert").allowed, true);
  });

  test("every expert path is covered by the prefix rules, not just the root", () => {
    for (const path of ["/expert", "/expert/wallet", "/expert/cases/42", "/api/expert/reviews"]) {
      assert.equal(areaForPath(path), "expert", path);
      assert.equal(authorize(customer, path).allowed, false, path);
    }
  });

  test("case is not a way around the guard", () => {
    assert.equal(authorize(customer, "/Expert/Wallet").allowed, false);
  });

  test("a path that merely starts with the same letters is not the expert area", () => {
    assert.equal(areaForPath("/experts.html"), "public");
    assert.equal(areaForPath("/expertise"), "public");
  });
});

describe("the admin area", () => {
  test("only an admin enters", () => {
    assert.equal(canEnterArea(admin, "admin").allowed, true);
    assert.equal(canEnterArea(expert, "admin").allowed, false);
    assert.equal(canEnterArea(customer, "admin").allowed, false);
    assert.equal(canEnterArea(null, "admin").status, 401);
  });

  test("a refusal reads as not-found rather than confirming the area", () => {
    assert.equal(canEnterArea(customer, "admin").status, 404);
  });
});

/* --- Resources ------------------------------------------------------------ */

describe("submissions", () => {
  const submission = { customerId: "u-cust", expertId: "e-1" };

  test("the customer who filed it can read it", () => {
    assert.equal(canReadSubmission(customer, submission).allowed, true);
  });

  test("another customer cannot", () => {
    const stranger: Principal = { ...customer, userId: "u-other" };
    assert.equal(canReadSubmission(stranger, submission).allowed, false);
  });

  test("the assigned expert can read it", () => {
    assert.equal(canReadSubmission(expert, submission).allowed, true);
  });

  test("an unassigned expert cannot", () => {
    assert.equal(canReadSubmission(otherExpert, submission).allowed, false);
  });

  test("an assigned expert who has not signed cannot open the clinical material", () => {
    const decision = canReadSubmission(unsignedExpert, submission);
    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /agreement/i);
  });

  test("an admin can read it", () => {
    assert.equal(canReadSubmission(admin, submission).allowed, true);
  });
});

describe("reviews", () => {
  const review = { expertId: "e-1" };

  test("an expert reads and writes their own", () => {
    assert.equal(canReadReview(expert, review).allowed, true);
    assert.equal(canWriteReview(expert, review).allowed, true);
  });

  test("another expert cannot", () => {
    assert.equal(canReadReview(otherExpert, review).allowed, false);
    assert.equal(canWriteReview(otherExpert, review).allowed, false);
  });

  test("a customer does not see the draft", () => {
    assert.equal(canReadReview(customer, review).allowed, false);
  });

  test("an unsigned expert cannot submit a review", () => {
    assert.equal(canWriteReview(unsignedExpert, review).allowed, false);
  });
});

describe("wallets and payout details", () => {
  const wallet = { expertId: "e-1" };

  test("an expert reads their own wallet", () => {
    assert.equal(canReadWallet(expert, wallet).allowed, true);
  });

  test("another expert cannot", () => {
    assert.equal(canReadWallet(otherExpert, wallet).allowed, false);
  });

  test("not even an admin reads an expert's wallet", () => {
    // Admins approve payouts; they have no route that returns bank details.
    assert.equal(canReadWallet(admin, wallet).allowed, false);
  });

  test("a customer certainly cannot", () => {
    assert.equal(canReadWallet(customer, wallet).allowed, false);
    assert.equal(canReadWallet(null, wallet).status, 401);
  });

  test("payout details can only be entered after the agreement is signed", () => {
    assert.equal(canWritePayoutDetails(expert, wallet).allowed, true);
    const decision = canWritePayoutDetails(unsignedExpert, wallet);
    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /agreement/i);
  });

  test("an unauthenticated request can never write payout details", () => {
    assert.equal(canWritePayoutDetails(null, wallet).allowed, false);
    assert.equal(canWritePayoutDetails(customer, wallet).allowed, false);
  });
});

/* --- Configuration -------------------------------------------------------- */

describe("secrets come from the environment", () => {
  test("a missing Paystack key fails loudly with a pointer to the fix", () => {
    assert.throws(
      () => paystackSecretKey({}),
      (error: unknown) => {
        assert.ok(error instanceof MissingConfigError);
        assert.match(error.message, /PAYSTACK_SECRET_KEY/);
        assert.match(error.message, /\.env|Vercel/);
        return true;
      },
    );
  });

  test("a public key in the secret slot is refused", () => {
    assert.throws(() => paystackSecretKey({ PAYSTACK_SECRET_KEY: "pk_live_abc" }), MissingConfigError);
  });

  test("a real secret key is accepted", () => {
    assert.equal(paystackSecretKey({ PAYSTACK_SECRET_KEY: "sk_test_abc" }), "sk_test_abc");
  });

  test("credential shapes are redacted before anything is logged", () => {
    // Synthetic values with the right shape. Never paste a real key into a test:
    // a fixture in a public repository is a published secret.
    const paystack = ["sk", "live", "0".repeat(40)].join("_");
    const anthropic = ["sk-ant-api03", "A".repeat(40)].join("-");

    const safe = redact(`POST /page failed ${paystack} ${anthropic}`);
    assert.ok(!safe.includes(paystack));
    assert.ok(!safe.includes(anthropic));
    assert.match(safe, /\[redacted\]/);
  });
});
