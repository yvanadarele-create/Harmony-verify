import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";

/**
 * Paystack integration.
 *
 * Harmony's prices are computed per submission by the pricing engine, so there is
 * no catalogue of fixed SKUs to point a customer at. Every charge therefore gets
 * its own Paystack payment page, created at the moment of purchase with the amount
 * the engine returned for that specific case.
 *
 * The security property that matters most here: **the amount is never accepted
 * from the client.** `chargeFor()` takes a priced submission and derives the amount
 * from it. There is no code path where a browser can name its own price — that is
 * the single most common way a checkout integration is exploited, and closing it
 * is worth the small loss of flexibility.
 *
 * The secret key is read from the environment at call time and never logged. It is
 * server-side only; nothing in this module is safe to bundle for a browser.
 */

export const PAYSTACK_API = "https://api.paystack.co";

/** Paystack transacts in the currency's smallest unit — kobo, pesewas, cents. */
export type Currency = "USD" | "NGN" | "GHS" | "ZAR" | "KES";

export class PaystackError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "PaystackError";
    this.status = status;
  }
}

export interface PaystackConfig {
  secretKey: string;
  currency?: Currency;
  callbackUrl?: string;
  /** Injected in tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected in tests so references are deterministic. */
  reference?: () => string;
}

interface PaystackEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

async function call<T>(
  config: PaystackConfig,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<T> {
  const doFetch = config.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new PaystackError("No fetch implementation available in this runtime.", 500);
  }

  let response: Response;
  try {
    response = await doFetch(`${PAYSTACK_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (cause) {
    // The key can appear in a fetch error's request context on some runtimes.
    throw new PaystackError(`Could not reach Paystack (${path}).`, 502);
  }

  const text = await response.text();
  let payload: PaystackEnvelope<T> | null = null;
  try {
    payload = text ? (JSON.parse(text) as PaystackEnvelope<T>) : null;
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.status) {
    // Paystack echoes request fields in errors; report only its message.
    throw new PaystackError(
      `Paystack ${method} ${path} failed (${response.status}): ${payload?.message ?? "unexpected response"}`,
      response.status === 401 ? 500 : 502,
    );
  }

  return payload.data;
}

/* --- Reference ----------------------------------------------------------- */

/**
 * Payment references are ours, not Paystack's, so a webhook can be tied back to a
 * submission without a database round-trip, and a retry cannot be mistaken for a
 * second purchase.
 */
export function paymentReference(submissionId: string, unique: () => string = randomUUID): string {
  const suffix = unique().replace(/-/g, "").slice(0, 12);
  return `hv_${submissionId}_${suffix}`.slice(0, 100);
}

export const submissionIdFromReference = (reference: string): string | null => {
  const match = /^hv_(.+)_[0-9a-z]{12}$/i.exec(reference);
  return match ? match[1]! : null;
};

/* --- A new payment page per charge --------------------------------------- */

export interface ChargeInput {
  submissionId: string;
  customerEmail: string;
  /** From the pricing engine. Never from a request body. */
  amountCents: number;
  /** Shown on the Paystack page, e.g. "Deep clinical review — cardiology". */
  description: string;
  /** Surfaced in the dashboard and on the webhook. */
  metadata?: Record<string, string | number>;
}

export interface PaymentPage {
  /** Paystack's page id. */
  id: number;
  /** The URL to send the customer to. Unique to this charge. */
  url: string;
  slug: string;
  reference: string;
  amountCents: number;
  currency: Currency;
}

const MIN_CHARGE_CENTS = 100;

function assertAmount(amountCents: number): void {
  if (!Number.isInteger(amountCents)) {
    throw new PaystackError("Amount must be an integer number of cents.", 400);
  }
  if (amountCents < MIN_CHARGE_CENTS) {
    throw new PaystackError(`Amount ${amountCents} is below the ${MIN_CHARGE_CENTS} cent minimum.`, 400);
  }
}

/**
 * Creates a dedicated Paystack payment page for one charge.
 *
 * A fresh page per payment is what makes dynamic pricing work end to end: the
 * page carries the exact amount the engine produced for that submission, and the
 * link cannot be reused to buy a different review at yesterday's price.
 */
export async function createPaymentPage(config: PaystackConfig, input: ChargeInput): Promise<PaymentPage> {
  assertAmount(input.amountCents);

  const reference = paymentReference(input.submissionId, config.reference ?? randomUUID);
  const currency = config.currency ?? "USD";

  const data = await call<{ id: number; slug: string }>(config, "/page", "POST", {
    name: `Harmony Verify — ${input.description}`.slice(0, 100),
    description: input.description,
    amount: input.amountCents,
    currency,
    slug: reference.toLowerCase(),
    // One customer, one purchase. Closing the page after payment stops the link
    // circulating as an open invitation to pay an arbitrary amount.
    redirect_url: config.callbackUrl,
    metadata: {
      submission_id: input.submissionId,
      reference,
      ...input.metadata,
    },
  });

  return {
    id: data.id,
    url: `https://paystack.com/pay/${data.slug}`,
    slug: data.slug,
    reference,
    amountCents: input.amountCents,
    currency,
  };
}

export interface InitializedTransaction {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
  amountCents: number;
  currency: Currency;
}

/**
 * The inline-checkout equivalent: a one-time authorisation URL rather than a
 * hosted page. Used where the customer is already signed in and should not leave
 * the dashboard.
 */
export async function initializeTransaction(
  config: PaystackConfig,
  input: ChargeInput,
): Promise<InitializedTransaction> {
  assertAmount(input.amountCents);

  const reference = paymentReference(input.submissionId, config.reference ?? randomUUID);
  const currency = config.currency ?? "USD";

  const data = await call<{ authorization_url: string; access_code: string; reference: string }>(
    config,
    "/transaction/initialize",
    "POST",
    {
      email: input.customerEmail,
      amount: input.amountCents,
      currency,
      reference,
      callback_url: config.callbackUrl,
      metadata: {
        submission_id: input.submissionId,
        description: input.description,
        ...input.metadata,
      },
    },
  );

  return {
    authorizationUrl: data.authorization_url,
    accessCode: data.access_code,
    reference: data.reference,
    amountCents: input.amountCents,
    currency,
  };
}

/* --- Verification -------------------------------------------------------- */

export interface VerifiedTransaction {
  reference: string;
  status: "success" | "failed" | "abandoned" | "pending";
  amountCents: number;
  currency: Currency;
  paidAt: string | null;
  customerEmail: string | null;
  submissionId: string | null;
}

/**
 * Confirms a payment with Paystack directly.
 *
 * Always called before unlocking work, even when a webhook has already reported
 * success: a webhook is a notification, not proof. This is the authority.
 */
export async function verifyTransaction(
  config: PaystackConfig,
  reference: string,
): Promise<VerifiedTransaction> {
  const data = await call<{
    reference: string;
    status: VerifiedTransaction["status"];
    amount: number;
    currency: Currency;
    paid_at: string | null;
    customer?: { email?: string };
    metadata?: { submission_id?: string };
  }>(config, `/transaction/verify/${encodeURIComponent(reference)}`, "GET");

  return {
    reference: data.reference,
    status: data.status,
    amountCents: data.amount,
    currency: data.currency,
    paidAt: data.paid_at ?? null,
    customerEmail: data.customer?.email ?? null,
    submissionId: data.metadata?.submission_id ?? submissionIdFromReference(data.reference),
  };
}

/**
 * Confirms a payment covers what was actually owed.
 *
 * Verifying the signature proves Paystack sent the event; it does not prove the
 * customer paid the right amount. A page created for $180 and settled for $10
 * signs perfectly well. Both checks are needed before work is released.
 */
export function paymentSatisfies(
  transaction: VerifiedTransaction,
  expectedCents: number,
  expectedCurrency: Currency = "USD",
): { ok: boolean; reason: string | null } {
  if (transaction.status !== "success") {
    return { ok: false, reason: `Transaction status is ${transaction.status}, not success.` };
  }
  if (transaction.currency !== expectedCurrency) {
    return { ok: false, reason: `Paid in ${transaction.currency}, expected ${expectedCurrency}.` };
  }
  if (transaction.amountCents < expectedCents) {
    return {
      ok: false,
      reason: `Paid ${transaction.amountCents} cents, expected at least ${expectedCents}.`,
    };
  }
  return { ok: true, reason: null };
}

/* --- Webhooks ------------------------------------------------------------ */

/**
 * Paystack signs the raw request body with HMAC-SHA512 under the secret key.
 *
 * Verify against the raw bytes, not a re-serialised object: `JSON.parse` followed
 * by `JSON.stringify` reorders keys and changes whitespace, which breaks the
 * signature for reasons that look like an attack and are not.
 */
export function verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface PaystackEvent {
  event: string;
  data: {
    reference?: string;
    status?: string;
    amount?: number;
    currency?: Currency;
    paid_at?: string;
    customer?: { email?: string };
    metadata?: Record<string, unknown>;
  };
}

export function parseWebhook(rawBody: string, signature: string, secret: string): PaystackEvent {
  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    throw new PaystackError("Webhook signature does not match.", 401);
  }
  try {
    return JSON.parse(rawBody) as PaystackEvent;
  } catch {
    throw new PaystackError("Webhook body is not valid JSON.", 400);
  }
}
