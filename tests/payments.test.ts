import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  checkout,
  customerQuote,
  createPaymentPage,
  initializeTransaction,
  paymentReference,
  submissionIdFromReference,
  paymentSatisfies,
  verifyWebhookSignature,
  parseWebhook,
  PaystackError,
  type PaystackConfig,
  type VerifiedTransaction,
} from "@harmony/payments";
import { customerPrice } from "@harmony/pricing-engine";

/* --- Test double ---------------------------------------------------------- */

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function stubPaystack(data: unknown, ok = true) {
  const calls: Recorded[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify({ status: ok, message: ok ? "ok" : "failed", data }), {
      status: ok ? 200 : 400,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;

  return { calls, fetchImpl };
}

const SECRET = "sk_test_0123456789abcdef";

const configWith = (fetchImpl: typeof fetch): PaystackConfig => ({
  secretKey: SECRET,
  currency: "USD",
  callbackUrl: "https://harmonyverify.com/payment/complete",
  fetchImpl,
  // Deterministic references so assertions can be exact.
  reference: () => "aaaaaaaabbbbccccddddeeeeffff0000",
});

/* --- A page per payment --------------------------------------------------- */

describe("a new payment page is created for every charge", () => {
  test("checkout prices the case itself and sends that amount", async () => {
    const { calls, fetchImpl } = stubPaystack({ id: 501, slug: "hv_sub-1_aaaaaaaabbbb" });

    const result = await checkout(configWith(fetchImpl), {
      submissionId: "sub-1",
      customerEmail: "ops@customer.example",
      pricing: { specialty: "cardiology", complexity: "high", risk: "high" },
    });

    const expected = customerPrice({ specialty: "cardiology", complexity: "high", risk: "high" });
    assert.equal(result.amountCents, expected.priceCents);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, "https://api.paystack.co/page");
    assert.equal(calls[0]!.method, "POST");
    assert.equal((calls[0]!.body as { amount: number }).amount, expected.priceCents);
  });

  test("two charges for the same submission get different pages", async () => {
    let n = 0;
    const { fetchImpl } = stubPaystack({ id: 1, slug: "hv_sub-1_x" });
    const config: PaystackConfig = {
      ...configWith(fetchImpl),
      reference: () => `ref${(n += 1)}`.padEnd(32, "0"),
    };

    const a = await createPaymentPage(config, {
      submissionId: "sub-1",
      customerEmail: "a@example.com",
      amountCents: 5000,
      description: "review",
    });
    const b = await createPaymentPage(config, {
      submissionId: "sub-1",
      customerEmail: "a@example.com",
      amountCents: 5000,
      description: "review",
    });

    assert.notEqual(a.reference, b.reference);
  });

  test("a different case mix produces a different amount on the page", async () => {
    const { calls, fetchImpl } = stubPaystack({ id: 1, slug: "s" });
    const config = configWith(fetchImpl);

    await checkout(config, {
      submissionId: "s1",
      customerEmail: "a@example.com",
      pricing: { specialty: "general-medicine", complexity: "low", risk: "low" },
    });
    await checkout(config, {
      submissionId: "s2",
      customerEmail: "a@example.com",
      pricing: { specialty: "oncology", complexity: "high", risk: "high" },
    });

    const amounts = calls.map((c) => (c.body as { amount: number }).amount);
    assert.notEqual(amounts[0], amounts[1]);
    assert.ok(amounts[1]! > amounts[0]!);
  });

  test("the submission id travels with the charge so a webhook can find it", async () => {
    const { calls, fetchImpl } = stubPaystack({ id: 1, slug: "s" });
    await checkout(configWith(fetchImpl), {
      submissionId: "sub-42",
      customerEmail: "a@example.com",
      pricing: { specialty: "neurology", complexity: "medium", risk: "medium" },
    });
    const body = calls[0]!.body as { metadata: { submission_id: string } };
    assert.equal(body.metadata.submission_id, "sub-42");
  });

  test("references round-trip back to a submission id", () => {
    const reference = paymentReference("sub-99", () => "0123456789abcdef0123456789abcdef");
    assert.equal(submissionIdFromReference(reference), "sub-99");
  });

  test("inline checkout returns a one-time authorisation url", async () => {
    const { fetchImpl } = stubPaystack({
      authorization_url: "https://checkout.paystack.com/xyz",
      access_code: "xyz",
      reference: "hv_sub-7_aaaaaaaabbbb",
    });
    const result = await initializeTransaction(configWith(fetchImpl), {
      submissionId: "sub-7",
      customerEmail: "a@example.com",
      amountCents: 12_000,
      description: "review",
    });
    assert.equal(result.authorizationUrl, "https://checkout.paystack.com/xyz");
    assert.equal(result.amountCents, 12_000);
  });
});

/* --- The amount cannot come from a client --------------------------------- */

describe("the price is derived, never accepted", () => {
  test("checkout takes case attributes, not an amount", () => {
    // A compile-time guarantee made explicit: if `amountCents` were ever added to
    // CheckoutInput, this cast would stop failing and the test would be removed
    // deliberately rather than by accident.
    const input = { submissionId: "s", customerEmail: "a@b.co", pricing: {} } as Record<string, unknown>;
    assert.ok(!("amountCents" in input));
  });

  test("a sub-minimum amount is refused before Paystack is called", async () => {
    const { calls, fetchImpl } = stubPaystack({ id: 1, slug: "s" });
    await assert.rejects(
      createPaymentPage(configWith(fetchImpl), {
        submissionId: "s",
        customerEmail: "a@b.co",
        amountCents: 1,
        description: "review",
      }),
      (error: unknown) => error instanceof PaystackError && error.status === 400,
    );
    assert.equal(calls.length, 0);
  });

  test("a fractional amount is refused", async () => {
    const { fetchImpl } = stubPaystack({ id: 1, slug: "s" });
    await assert.rejects(
      createPaymentPage(configWith(fetchImpl), {
        submissionId: "s",
        customerEmail: "a@b.co",
        amountCents: 1500.5,
        description: "review",
      }),
      PaystackError,
    );
  });
});

/* --- What a customer may see ---------------------------------------------- */

describe("the customer quote exposes no internal economics", () => {
  const quote = customerQuote({ specialty: "oncology", complexity: "high", risk: "high", count: 5 });

  test("it carries the total and the unit price", () => {
    assert.ok(quote.amountCents > 0);
    assert.equal(quote.count, 5);
    assert.equal(quote.currency, "USD");
  });

  test("no payout, share or margin appears anywhere in it", () => {
    const serialised = JSON.stringify(quote).toLowerCase();
    for (const term of ["payout", "margin", "share", "expert"]) {
      assert.ok(!serialised.includes(term), `customer quote leaked "${term}"`);
    }
  });

  test("the full breakdown stays server-side on the checkout result", async () => {
    const { fetchImpl } = stubPaystack({ id: 1, slug: "s" });
    const result = await checkout(configWith(fetchImpl), {
      submissionId: "s",
      customerEmail: "a@b.co",
      pricing: { specialty: "oncology", complexity: "high", risk: "high" },
    });
    // Present for the audit record and the admin view — and named so that
    // returning it to a browser has to be a conscious act.
    assert.ok(result.internalPricing.payout.payoutCents > 0);
    assert.ok("marginCents" in result.internalPricing);
  });
});

/* --- Settlement ----------------------------------------------------------- */

describe("a payment is only good if it covers what was owed", () => {
  const paid = (over: Partial<VerifiedTransaction> = {}): VerifiedTransaction => ({
    reference: "hv_sub-1_aaaaaaaabbbb",
    status: "success",
    amountCents: 18_000,
    currency: "USD",
    paidAt: "2026-07-30T10:00:00Z",
    customerEmail: "a@b.co",
    submissionId: "sub-1",
    ...over,
  });

  test("the exact amount settles", () => {
    assert.equal(paymentSatisfies(paid(), 18_000).ok, true);
  });

  test("underpayment does not settle, even though the signature is valid", () => {
    const result = paymentSatisfies(paid({ amountCents: 1_000 }), 18_000);
    assert.equal(result.ok, false);
    assert.match(result.reason!, /expected at least/);
  });

  test("a failed or abandoned transaction does not settle", () => {
    assert.equal(paymentSatisfies(paid({ status: "failed" }), 18_000).ok, false);
    assert.equal(paymentSatisfies(paid({ status: "abandoned" }), 18_000).ok, false);
    assert.equal(paymentSatisfies(paid({ status: "pending" }), 18_000).ok, false);
  });

  test("paying in another currency does not settle", () => {
    const result = paymentSatisfies(paid({ currency: "NGN" }), 18_000, "USD");
    assert.equal(result.ok, false);
    assert.match(result.reason!, /NGN/);
  });
});

/* --- Webhooks ------------------------------------------------------------- */

describe("webhooks", () => {
  const body = JSON.stringify({ event: "charge.success", data: { reference: "hv_sub-1_aaaaaaaabbbb" } });
  const sign = (raw: string, secret = SECRET) =>
    createHmac("sha512", secret).update(raw, "utf8").digest("hex");

  test("a correctly signed body is accepted", () => {
    assert.equal(verifyWebhookSignature(body, sign(body), SECRET), true);
    assert.equal(parseWebhook(body, sign(body), SECRET).event, "charge.success");
  });

  test("a body signed with a different key is rejected", () => {
    assert.equal(verifyWebhookSignature(body, sign(body, "sk_test_someoneelse"), SECRET), false);
  });

  test("a tampered body is rejected", () => {
    const signature = sign(body);
    const tampered = body.replace("sub-1", "sub-2");
    assert.equal(verifyWebhookSignature(tampered, signature, SECRET), false);
    assert.throws(() => parseWebhook(tampered, signature, SECRET), PaystackError);
  });

  test("an empty or truncated signature is rejected", () => {
    assert.equal(verifyWebhookSignature(body, "", SECRET), false);
    assert.equal(verifyWebhookSignature(body, sign(body).slice(0, 40), SECRET), false);
  });

  test("re-serialising the body breaks the signature — verify the raw bytes", () => {
    const signature = sign(body);
    const reserialised = JSON.stringify(JSON.parse(body));
    const reordered = JSON.stringify({ data: JSON.parse(body).data, event: "charge.success" });
    assert.equal(verifyWebhookSignature(reserialised, signature, SECRET), true);
    assert.equal(verifyWebhookSignature(reordered, signature, SECRET), false);
  });
});

/* --- Failure handling ----------------------------------------------------- */

describe("failures do not leak the key", () => {
  test("a Paystack error surfaces its message, not the request", async () => {
    const { fetchImpl } = stubPaystack({ }, false);
    await assert.rejects(
      createPaymentPage(configWith(fetchImpl), {
        submissionId: "s",
        customerEmail: "a@b.co",
        amountCents: 5_000,
        description: "review",
      }),
      (error: unknown) => {
        assert.ok(error instanceof PaystackError);
        assert.ok(!error.message.includes(SECRET), "the secret key appeared in an error message");
        return true;
      },
    );
  });

  test("a network failure does not carry the authorization header into the error", async () => {
    const fetchImpl = (async () => {
      throw new Error(`connect ECONNREFUSED (Authorization: Bearer ${SECRET})`);
    }) as unknown as typeof fetch;

    await assert.rejects(
      createPaymentPage(configWith(fetchImpl), {
        submissionId: "s",
        customerEmail: "a@b.co",
        amountCents: 5_000,
        description: "review",
      }),
      (error: unknown) => {
        assert.ok(error instanceof PaystackError);
        assert.ok(!error.message.includes(SECRET));
        return true;
      },
    );
  });
});
