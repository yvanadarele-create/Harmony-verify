import { customerPrice, money, type PriceInput, type PriceResult } from "@harmony/pricing-engine";
import { createPaymentPage, type ChargeInput, type PaymentPage, type PaystackConfig } from "./paystack.js";

export * from "./paystack.js";

/**
 * The one supported route from a submission to a Paystack page.
 *
 * `checkout()` prices the submission itself and hands the result straight to
 * Paystack. There is deliberately no `amountCents` parameter on this function:
 * a caller cannot pass a price in, so no request handler can be tricked into
 * forwarding one from a browser. Dynamic pricing and trustworthy pricing are the
 * same mechanism here.
 */
export interface CheckoutInput {
  submissionId: string;
  customerEmail: string;
  pricing: PriceInput;
  /** Human-readable line for the Paystack page. */
  description?: string;
}

export interface Checkout {
  page: PaymentPage;
  /** What the customer owes, in cents. */
  amountCents: number;
  /** Formatted for display. */
  amount: string;
  /**
   * Full pricing breakdown, including expert payout and margin.
   *
   * Server-side only. This is the object the punch list's "do not expose
   * expert_payout or EXPERT_SHARE" rule is about — it belongs in an audit record
   * and an admin view, never in an API response to a customer.
   */
  internalPricing: PriceResult;
}

export async function checkout(config: PaystackConfig, input: CheckoutInput): Promise<Checkout> {
  const pricing = customerPrice(input.pricing);
  const description =
    input.description ??
    `${input.pricing.complexity} complexity ${input.pricing.specialty} review`;

  const charge: ChargeInput = {
    submissionId: input.submissionId,
    customerEmail: input.customerEmail,
    amountCents: pricing.priceCents,
    description,
    metadata: {
      specialty: input.pricing.specialty,
      complexity: input.pricing.complexity,
      risk: input.pricing.risk,
      review_mode: input.pricing.reviewMode ?? "single",
      count: input.pricing.count ?? 1,
    },
  };

  return {
    page: await createPaymentPage(config, charge),
    amountCents: pricing.priceCents,
    amount: money(pricing.priceCents),
    internalPricing: pricing,
  };
}

/**
 * The customer-facing projection of a price.
 *
 * Everything a customer is entitled to see and nothing else: the total, the
 * currency, and the case attributes that produced it. No payout, no margin, no
 * revenue share. Any handler returning pricing to a customer returns this.
 */
export interface CustomerQuote {
  amountCents: number;
  amount: string;
  currency: "USD";
  unitAmountCents: number;
  unitAmount: string;
  count: number;
  reviewMode: "single" | "double";
}

export function customerQuote(input: PriceInput): CustomerQuote {
  const pricing = customerPrice(input);
  return {
    amountCents: pricing.priceCents,
    amount: money(pricing.priceCents),
    currency: "USD",
    unitAmountCents: pricing.unitPriceCents,
    unitAmount: money(pricing.unitPriceCents),
    count: Math.max(1, Math.trunc(input.count ?? 1)),
    reviewMode: input.reviewMode ?? "single",
  };
}
