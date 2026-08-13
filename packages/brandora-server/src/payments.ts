/**
 * Payments.
 *
 * The rule this file exists to enforce: **the amount charged is read from the
 * stored quote, never from the request.** `initialise()` takes an order and a
 * `Money` the caller looked up server-side; there is no parameter through which
 * a browser can propose a price. And on the way back, `verify()` compares what
 * the provider says was paid against what Brandora recorded at initialisation —
 * a difference is a tampered payment and is refused, not reconciled.
 *
 * Credentials are read through `@brandora/config` and never leave this process.
 * The customer receives an authorization URL; they never receive a key.
 *
 * When no provider is configured, Brandora does not pretend to charge anyone.
 * `ManualTransferProvider` records the order as awaiting payment and tells the
 * customer how payment will be arranged — an honest state a business can
 * actually operate in, rather than a fake success that makes a demo look
 * finished and a launch fail.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import {
  BrandoraError,
  type CurrencyCode,
  type Money,
  ValidationError,
  money,
} from "@brandora/shared";
import { paystackConfigured, paystackEndpoint, paystackSecretKey } from "@brandora/config";

export interface PaymentIntent {
  /** Brandora's reference. The provider echoes it back on verification. */
  reference: string;
  /** Where to send the customer. Null when payment is arranged off-platform. */
  authorizationUrl: string | null;
  /** What the customer is told to do next, in a sentence. */
  instruction: string;
  provider: string;
}

export interface VerificationResult {
  /** Whether the provider says this reference is settled. */
  paid: boolean;
  /** What the provider says was paid, in minor units. */
  amount: Money | null;
  /** Provider-side status, for the admin view. */
  providerStatus: string;
}

export interface PaymentProvider {
  readonly name: string;
  readonly configured: boolean;
  initialise(input: {
    reference: string;
    amount: Money;
    email: string;
    callbackUrl: string;
  }): Promise<PaymentIntent>;
  verify(reference: string): Promise<VerificationResult>;
}

/** The HTTP call, injected so the provider is testable without a network. */
export type PaymentTransport = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; text: string }>;

const fetchTransport: PaymentTransport = async (url, init) => {
  const response = await fetch(url, init);
  return { status: response.status, text: await response.text() };
};

export class PaymentError extends BrandoraError {
  constructor(detail: string, status = 502) {
    super("internal", detail, status);
    this.name = "PaymentError";
  }
}

/**
 * Refusing a payment whose amount does not match the quote.
 *
 * Separate from a generic failure because it is not a transient problem: it
 * means the amount was changed between the quote and the charge, and it must
 * end up in the admin's inbox rather than in a retry loop.
 */
export class AmountMismatchError extends BrandoraError {
  constructor(expected: Money, actual: Money) {
    super(
      "internal",
      `payment amount mismatch: expected ${expected.amount} ${expected.currency}, provider reported ${actual.amount} ${actual.currency}`,
      409,
    );
    this.name = "AmountMismatchError";
  }
}

/* --- Paystack ------------------------------------------------------------- */

/**
 * Paystack takes amounts in the currency's smallest unit — which is exactly
 * what `Money.amount` already holds, including for XOF, where the smallest unit
 * *is* the franc. No `× 100` anywhere in this file: that multiplication is the
 * single most expensive bug available in a West African checkout.
 */
export class PaystackProvider implements PaymentProvider {
  readonly name = "paystack";

  constructor(
    private readonly secretKey: string,
    private readonly endpoint: string,
    private readonly transport: PaymentTransport = fetchTransport,
  ) {}

  get configured(): boolean {
    return true;
  }

  async initialise(input: {
    reference: string;
    amount: Money;
    email: string;
    callbackUrl: string;
  }): Promise<PaymentIntent> {
    const payload = await this.call("POST", "/transaction/initialize", {
      reference: input.reference,
      amount: input.amount.amount,
      currency: input.amount.currency,
      email: input.email,
      callback_url: input.callbackUrl,
    });

    const data = payload["data"];
    const url =
      typeof data === "object" && data !== null
        ? (data as Record<string, unknown>)["authorization_url"]
        : undefined;

    if (typeof url !== "string" || url === "") {
      throw new PaymentError("Paystack initialize returned no authorization_url");
    }

    return {
      reference: input.reference,
      authorizationUrl: url,
      instruction: "You'll be taken to our payment page to complete your order.",
      provider: this.name,
    };
  }

  async verify(reference: string): Promise<VerificationResult> {
    const payload = await this.call("GET", `/transaction/verify/${encodeURIComponent(reference)}`);
    const data = payload["data"];
    if (typeof data !== "object" || data === null) {
      throw new PaymentError("Paystack verify returned no transaction");
    }

    const record = data as Record<string, unknown>;
    const status = typeof record["status"] === "string" ? record["status"] : "unknown";
    const rawAmount = record["amount"];
    const rawCurrency = record["currency"];

    // An amount the provider did not send is not a zero. Reporting it as null
    // means the caller refuses rather than comparing against a number nobody
    // returned.
    const amount =
      typeof rawAmount === "number" && Number.isFinite(rawAmount) && typeof rawCurrency === "string"
        ? money(Math.round(rawAmount), rawCurrency.toUpperCase() as CurrencyCode)
        : null;

    return { paid: status === "success", amount, providerStatus: status };
  }

  private async call(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await this.transport(`${this.endpoint}${path}`, {
      method,
      headers: {
        // The one place the key is used. It is never logged: the catch below
        // reports the status and the path, not the request.
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.text);
    } catch {
      throw new PaymentError(`Paystack ${path} returned status ${response.status} and unparseable body`);
    }

    if (typeof parsed !== "object" || parsed === null) {
      throw new PaymentError(`Paystack ${path} returned a non-object body`);
    }
    const payload = parsed as Record<string, unknown>;

    if (response.status >= 400 || payload["status"] === false) {
      const message = typeof payload["message"] === "string" ? payload["message"] : "no message";
      throw new PaymentError(`Paystack ${path} failed with ${response.status}: ${message}`);
    }

    return payload;
  }
}

/**
 * Verify a Paystack webhook.
 *
 * The signature is an HMAC-SHA512 of the *raw* body with the secret key, so the
 * body must be compared before it is parsed — re-serialising JSON reorders keys
 * and invalidates the digest. Compared in constant time, because a fast
 * rejection leaks how much of a forged signature was correct.
 */
export function paystackSignatureValid(rawBody: string, signature: string | undefined, secretKey: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha512", secretKey).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/* --- No provider configured ----------------------------------------------- */

/**
 * What Brandora does before a payment provider is connected.
 *
 * It does not fabricate a charge. The order is created and sits at
 * `payment_status = 'pending'` until an administrator confirms the transfer,
 * which is both the honest state and the way a great many orders in this market
 * are actually settled.
 */
export class ManualTransferProvider implements PaymentProvider {
  readonly name = "manual-transfer";
  readonly configured = false;

  async initialise(input: { reference: string }): Promise<PaymentIntent> {
    return {
      reference: input.reference,
      authorizationUrl: null,
      instruction:
        "Your order is placed. Our team will contact you to arrange payment and confirm it before production starts.",
      provider: this.name,
    };
  }

  async verify(): Promise<VerificationResult> {
    // Never "paid". Only an administrator can settle a manual transfer, and
    // that path goes through the admin route, not through this one.
    return { paid: false, amount: null, providerStatus: "awaiting-manual-confirmation" };
  }
}

/** Pick a provider from the environment. Never throws for a missing credential. */
export function resolvePaymentProvider(
  source: Record<string, string | undefined> = process.env,
  transport?: PaymentTransport,
): PaymentProvider {
  if (!paystackConfigured(source)) return new ManualTransferProvider();
  return new PaystackProvider(paystackSecretKey(source), paystackEndpoint(source), transport);
}

/**
 * The check that makes price manipulation structural rather than procedural.
 *
 * Called on every verification. `expected` comes from the `payments` row
 * written at initialisation, which itself came from the stored quote — so a
 * customer who edits the amount at the provider, or replays another order's
 * reference, fails here rather than receiving goods.
 */
export function assertAmountMatches(expected: Money, actual: Money | null): void {
  if (!actual) {
    throw new PaymentError("payment provider reported no amount; refusing to settle");
  }
  if (actual.currency !== expected.currency || actual.amount !== expected.amount) {
    throw new AmountMismatchError(expected, actual);
  }
}

/** A provider reference a human can read back over the phone. */
export function paymentReference(orderReference: string, attempt: number): string {
  if (!orderReference) throw new ValidationError("orderReference", "is required");
  return `${orderReference}-P${String(attempt).padStart(2, "0")}`;
}
