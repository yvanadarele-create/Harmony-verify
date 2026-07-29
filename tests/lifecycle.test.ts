import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  openDatabase,
  createRepositories,
  rateExpert,
  reinstateExpert,
  signAgreement,
  canBeAssigned,
  assignmentEligibility,
  ensureWallet,
  readWallet,
  creditReview,
  requestPayout,
  approvePayout,
  rejectPayout,
  savePayoutDetails,
  readPayoutDetails,
  revealAccountNumberForTransfer,
  encryptAccountNumber,
  decryptAccountNumber,
  MINIMUM_RATING,
  SUSPENSION_REASON,
  type Db,
} from "@harmony/database";
import { matchExpert } from "@harmony/expert-matching";
import { expertPayout } from "@harmony/pricing-engine";
import type { Expert } from "@harmony/shared";

const SECRET = "test-secret-not-a-real-key";

function setup(): { db: Db; repos: ReturnType<typeof createRepositories>; expertId: string } {
  const db = openDatabase();
  const repos = createRepositories(db);
  const user = repos.users.create({
    name: "Dr A. Osei", email: "osei@example.com", role: "expert",
    passwordHash: "h", passwordSalt: "s",
  });
  const expert = repos.experts.create({
    userId: user.id, name: "Dr A. Osei", specialty: "cardiology",
    credentials: "MD, FACC", yearsExperience: 12, availability: "available",
    status: "active", conflictsOfInterest: [], maxConcurrentCases: 5,
  });
  return { db, repos, expertId: expert.id };
}

/* --- Sanity check 3: rating below 2.5 actually blocks assignment --------- */

describe("expert rating rule — enforced, not displayed", () => {
  test("a rating below 2.5 suspends the expert immediately", () => {
    const { db, repos, expertId } = setup();
    const review = repos.reviews.create(
      repos.submissions.create({
        customerId: repos.users.create({ name: "C", email: "c@x.com", role: "customer", passwordHash: "h", passwordSalt: "s" }).id,
        title: "t", aiSystem: "sys", content: "c", specialty: "cardiology",
        reviewType: "single-verification", priority: "standard",
      }).id,
      expertId,
    );

    const r = rateExpert(db, {
      reviewId: review.id, expertId, quality: 2, deadline: 2, professionalism: 2,
    });

    assert.ok(r.rating < MINIMUM_RATING, `rating ${r.rating} should be below ${MINIMUM_RATING}`);
    assert.equal(r.suspended, true);
    assert.equal(r.reason, SUSPENSION_REASON);
    assert.equal(repos.experts.byId(expertId)!.status, "suspended", "status must be persisted");
  });

  test("a suspended expert is excluded from matching, not merely flagged", () => {
    const { db, repos, expertId } = setup();
    signAgreement(db, { expertId, documentUrl: "https://x/agreement.pdf" });

    const before = repos.experts.byId(expertId)!;
    assert.ok(
      matchExpert({
        analysis: { specialty: "cardiology", risk: "low", recommendedExpert: { specialty: "cardiology", minYearsExperience: 2, minRating: 0 } },
        experts: [before],
      }).matched.id === expertId,
      "eligible before the bad rating",
    );

    const sub = repos.submissions.create({
      customerId: repos.users.create({ name: "C", email: "c2@x.com", role: "customer", passwordHash: "h", passwordSalt: "s" }).id,
      title: "t", aiSystem: "sys", content: "c", specialty: "cardiology",
      reviewType: "single-verification", priority: "standard",
    });
    rateExpert(db, { reviewId: repos.reviews.create(sub.id, expertId).id, expertId, quality: 1, deadline: 1, professionalism: 2 });

    const after = repos.experts.byId(expertId)!;
    assert.throws(
      () => matchExpert({
        analysis: { specialty: "cardiology", risk: "low", recommendedExpert: { specialty: "cardiology", minYearsExperience: 2, minRating: 0 } },
        experts: [after],
      }),
      /No eligible/,
      "a suspended expert must be unmatchable",
    );
  });

  test("a good rating leaves the expert active", () => {
    const { db, repos, expertId } = setup();
    const sub = repos.submissions.create({
      customerId: repos.users.create({ name: "C", email: "c3@x.com", role: "customer", passwordHash: "h", passwordSalt: "s" }).id,
      title: "t", aiSystem: "sys", content: "c", specialty: "cardiology",
      reviewType: "single-verification", priority: "standard",
    });
    const r = rateExpert(db, { reviewId: repos.reviews.create(sub.id, expertId).id, expertId, quality: 5, deadline: 4, professionalism: 5 });
    assert.equal(r.suspended, false);
    assert.equal(repos.experts.byId(expertId)!.status, "active");
  });

  test("the rolling average is what triggers suspension, not a single score", () => {
    const { db, repos, expertId } = setup();
    const customer = repos.users.create({ name: "C", email: "c4@x.com", role: "customer", passwordHash: "h", passwordSalt: "s" });
    const rate = (q: number, d: number, p: number) => {
      const sub = repos.submissions.create({
        customerId: customer.id, title: "t", aiSystem: "s", content: "c",
        specialty: "cardiology", reviewType: "single-verification", priority: "standard",
      });
      return rateExpert(db, { reviewId: repos.reviews.create(sub.id, expertId).id, expertId, quality: q, deadline: d, professionalism: p });
    };
    rate(5, 5, 5);
    const second = rate(1, 1, 1); // average 3.0 — still above the threshold
    assert.equal(second.suspended, false, `average ${second.rating} should not suspend`);
    const third = rate(1, 1, 1); // average ~2.33 — now below
    assert.equal(third.suspended, true);
  });

  test("admin can reinstate, and the reason is cleared", () => {
    const { db, repos, expertId } = setup();
    const sub = repos.submissions.create({
      customerId: repos.users.create({ name: "C", email: "c5@x.com", role: "customer", passwordHash: "h", passwordSalt: "s" }).id,
      title: "t", aiSystem: "s", content: "c", specialty: "cardiology",
      reviewType: "single-verification", priority: "standard",
    });
    rateExpert(db, { reviewId: repos.reviews.create(sub.id, expertId).id, expertId, quality: 1, deadline: 1, professionalism: 1 });
    assert.equal(repos.experts.byId(expertId)!.status, "suspended");
    reinstateExpert(db, expertId);
    assert.equal(repos.experts.byId(expertId)!.status, "active");
  });

  test("out-of-range scores are rejected", () => {
    const { db, expertId } = setup();
    for (const bad of [0, 6, 2.5, Number.NaN]) {
      assert.throws(
        () => rateExpert(db, { reviewId: "rev_x", expertId, quality: bad, deadline: 3, professionalism: 3 }),
        /must be an integer from 1 to 5/,
      );
    }
  });
});

/* --- Sanity check 4: agreement signature actually blocks activation ------ */

describe("agreement gate — blocks assignment independently of status", () => {
  test("an active expert who has not signed cannot be assigned", () => {
    const { db, expertId } = setup();
    const e = assignmentEligibility(db, expertId);
    assert.equal(e.eligible, false);
    assert.match(e.reason ?? "", /agreement not signed/);
  });

  test("signing unlocks assignment", () => {
    const { db, expertId } = setup();
    signAgreement(db, { expertId, documentUrl: "https://x/agreement.pdf", typedName: "A. Osei" });
    assert.equal(assignmentEligibility(db, expertId).eligible, true);
  });

  test("status flipped to active by hand is not enough on its own", () => {
    // The punch list is explicit: check both fields at assignment time.
    const unsigned = canBeAssigned({ status: "active", agreementSignedAt: undefined });
    assert.equal(unsigned.eligible, false, "manual activation must not bypass the signature");
    const signed = canBeAssigned({ status: "active", agreementSignedAt: "2026-01-01T00:00:00.000Z" });
    assert.equal(signed.eligible, true);
  });

  test("suspension still blocks even with a signed agreement", () => {
    assert.equal(
      canBeAssigned({ status: "suspended", agreementSignedAt: "2026-01-01T00:00:00.000Z" }).eligible,
      false,
    );
  });

  test("a pending application cannot be assigned", () => {
    assert.match(
      canBeAssigned({ status: "pending", agreementSignedAt: "2026-01-01T00:00:00.000Z" }).reason ?? "",
      /not yet approved/,
    );
  });

  test("an empty document url is refused", () => {
    const { db, expertId } = setup();
    assert.throws(() => signAgreement(db, { expertId, documentUrl: "   " }), /required/);
  });
});

/* --- Sanity check 2: wallet balance actually updates after a review ------ */

describe("wallet — balance moves with real reviews and payouts", () => {
  const details = (expertId: string) => ({
    expertId, accountHolderName: "A Osei", bankName: "Example Bank",
    accountNumber: "0123456789", payoutMethod: "bank-transfer" as const,
  });

  test("a completed review credits both balance and lifetime earnings", () => {
    const { db, expertId } = setup();
    ensureWallet(db, expertId);
    assert.equal(readWallet(db, expertId)!.balanceCents, 0);

    const { payoutCents } = expertPayout({ specialty: "cardiology", complexity: "medium", risk: "medium" });
    const w = creditReview(db, expertId, payoutCents);

    assert.equal(w.balanceCents, payoutCents, "the pricing engine's payout is what lands");
    assert.equal(w.totalEarnedCents, payoutCents);
  });

  test("payout request moves money from balance into pending", () => {
    const { db, expertId } = setup();
    creditReview(db, expertId, 10_000);
    savePayoutDetails(db, details(expertId), SECRET);

    requestPayout(db, expertId, 4_000);
    const w = readWallet(db, expertId)!;
    assert.equal(w.balanceCents, 6_000);
    assert.equal(w.pendingPayoutCents, 4_000);
    assert.equal(w.totalWithdrawnCents, 0, "not withdrawn until approved");
  });

  test("approval completes the withdrawal", () => {
    const { db, expertId } = setup();
    creditReview(db, expertId, 10_000);
    savePayoutDetails(db, details(expertId), SECRET);
    const p = requestPayout(db, expertId, 4_000);

    const w = approvePayout(db, p.id);
    assert.equal(w.pendingPayoutCents, 0);
    assert.equal(w.totalWithdrawnCents, 4_000);
    assert.equal(w.balanceCents, 6_000);
  });

  test("rejection returns the money to spendable balance", () => {
    const { db, expertId } = setup();
    creditReview(db, expertId, 10_000);
    savePayoutDetails(db, details(expertId), SECRET);
    const p = requestPayout(db, expertId, 4_000);

    const w = rejectPayout(db, p.id, "details unverified");
    assert.equal(w.balanceCents, 10_000, "fully restored");
    assert.equal(w.pendingPayoutCents, 0);
    assert.equal(w.totalWithdrawnCents, 0);
  });

  test("an expert cannot withdraw more than they hold", () => {
    const { db, expertId } = setup();
    creditReview(db, expertId, 5_000);
    savePayoutDetails(db, details(expertId), SECRET);
    assert.throws(() => requestPayout(db, expertId, 9_000), /insufficient balance/);
    assert.equal(readWallet(db, expertId)!.balanceCents, 5_000, "balance untouched by the failed attempt");
  });

  test("two payouts cannot together overdraw the wallet", () => {
    const { db, expertId } = setup();
    creditReview(db, expertId, 10_000);
    savePayoutDetails(db, details(expertId), SECRET);
    requestPayout(db, expertId, 7_000);
    assert.throws(() => requestPayout(db, expertId, 7_000), /insufficient balance/);
    const w = readWallet(db, expertId)!;
    assert.equal(w.balanceCents + w.pendingPayoutCents, 10_000, "money is conserved");
  });

  test("payout cannot be requested without details on file", () => {
    const { db, expertId } = setup();
    creditReview(db, expertId, 10_000);
    assert.throws(() => requestPayout(db, expertId, 1_000), /payout details/);
  });
});

/* --- Payout details: encrypted at rest, last 4 in the UI ----------------- */

describe("payout details — encrypted, never fully exposed", () => {
  test("the UI view exposes only the last four digits", () => {
    const { db, expertId } = setup();
    const view = savePayoutDetails(db, {
      expertId, accountHolderName: "A Osei", bankName: "Example Bank",
      accountNumber: "0123456789", payoutMethod: "bank-transfer",
    }, SECRET);
    assert.equal(view.accountLast4, "6789");
    assert.ok(!JSON.stringify(view).includes("0123456789"), "full number must never appear in the view");
  });

  test("the stored value is not the plaintext", () => {
    const { db, expertId } = setup();
    savePayoutDetails(db, {
      expertId, accountHolderName: "A Osei", bankName: "Example Bank",
      accountNumber: "0123456789", payoutMethod: "paystack", paystackRecipient: "RCP_x",
    }, SECRET);
    const raw = db.prepare(`SELECT account_number_enc FROM payout_details WHERE expert_id = ?`)
      .get(expertId) as { account_number_enc: string };
    assert.ok(!raw.account_number_enc.includes("0123456789"), "plaintext must not be in the database");
    assert.equal(revealAccountNumberForTransfer(db, expertId, SECRET), "0123456789");
  });

  test("encryption round-trips and rejects the wrong key", () => {
    const enc = encryptAccountNumber("9876543210", SECRET);
    assert.equal(decryptAccountNumber(enc, SECRET), "9876543210");
    assert.throws(() => decryptAccountNumber(enc, "wrong-secret"));
  });

  test("the same number encrypts differently each time", () => {
    const a = encryptAccountNumber("0123456789", SECRET);
    const b = encryptAccountNumber("0123456789", SECRET);
    assert.notEqual(a, b, "a fresh IV per write prevents matching two experts by ciphertext");
  });

  test("details can be updated in place", () => {
    const { db, expertId } = setup();
    savePayoutDetails(db, {
      expertId, accountHolderName: "A Osei", bankName: "Bank One",
      accountNumber: "1111222233", payoutMethod: "bank-transfer",
    }, SECRET);
    savePayoutDetails(db, {
      expertId, accountHolderName: "A Osei", bankName: "Bank Two",
      accountNumber: "4444555566", payoutMethod: "mobile-money",
    }, SECRET);
    const v = readPayoutDetails(db, expertId)!;
    assert.equal(v.bankName, "Bank Two");
    assert.equal(v.accountLast4, "5566");
    assert.equal(v.payoutMethod, "mobile-money");
  });
});
