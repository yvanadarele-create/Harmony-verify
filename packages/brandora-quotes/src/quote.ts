/**
 * The Quote Engine (§43).
 *
 * A quote is the moment Brandora stops being a tool and becomes a business: it
 * is a number a founder will budget against, show a partner, and hold Brandora
 * to. Three properties follow from that, and each is enforced here rather than
 * left to the caller.
 *
 * **It adds up.** The category totals always sum to the quote total. A quote
 * whose parts do not reconcile is the first thing a careful buyer spots.
 *
 * **It expires.** Supplier prices and freight move. A quote with no validity
 * date is a promise Brandora cannot keep, so `validUntil` is mandatory and
 * approval past it is refused rather than honoured quietly.
 *
 * **It shows no supplier cost.** The lines are built from `CustomerBreakdown`
 * shapes, which never held a supplier figure (§39).
 */

import {
  type BrandPackage,
  type BrandProfile,
  type CurrencyCode,
  type Money,
  type Quote,
  type QuoteLine,
  type QuoteStatus,
  BrandoraError,
  ValidationError,
  add,
  money,
  newId,
  sum,
  zero,
} from "@brandora/shared";

/** One priced product on the quote. Contains only customer-safe figures. */
export interface PricedLine {
  productId: string;
  description: string;
  quantity: number;
  unitPrice: Money;
  productsTotal: Money;
  customizationTotal: Money;
  shippingTotal: Money;
  logisticsTotal: Money;
  serviceTotal: Money;
  /** Only when a carrier actually published one (§38). */
  deliveryEstimate?: string;
}

export interface CreateQuoteOptions {
  brand: BrandProfile;
  package: BrandPackage;
  lines: readonly PricedLine[];
  currency?: CurrencyCode;
  /** How long the quote holds. Short enough to be honest about freight moving. */
  validForDays?: number;
  now?: Date;
  /** Sequence within the year, for the human-readable reference. */
  sequence?: number;
}

export const DEFAULT_VALIDITY_DAYS = 14;

/**
 * A reference a person can read down a phone line.
 *
 * `BRA-2026-0043`. Not the quote's id — a `qte_9f2c…` is unspeakable, and every
 * support conversation about a quote starts with someone reading it aloud.
 */
export function quoteReference(now: Date, sequence: number): string {
  return `BRA-${now.getUTCFullYear()}-${String(sequence).padStart(4, "0")}`;
}

export function createQuote(options: CreateQuoteOptions): Quote {
  const now = options.now ?? new Date();
  const currency = options.currency ?? options.package.currency;

  if (options.lines.length === 0) {
    throw new ValidationError("lines", "a quote needs at least one product");
  }
  for (const line of options.lines) {
    if (line.unitPrice.currency !== currency) {
      throw new ValidationError(
        "currency",
        `line "${line.description}" is priced in ${line.unitPrice.currency}, quote is in ${currency}`,
      );
    }
    if (line.quantity <= 0) {
      throw new ValidationError("quantity", `line "${line.description}" has quantity ${line.quantity}`);
    }
  }

  const quoteLines: QuoteLine[] = options.lines.map((line) => ({
    id: newId("quoteItem"),
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    total: add(
      add(line.productsTotal, line.customizationTotal),
      add(add(line.shippingTotal, line.logisticsTotal), line.serviceTotal),
    ),
  }));

  const productsTotal = sum(options.lines.map((l) => l.productsTotal), currency);
  const customizationTotal = sum(options.lines.map((l) => l.customizationTotal), currency);
  const shippingTotal = sum(options.lines.map((l) => l.shippingTotal), currency);
  const logisticsTotal = sum(options.lines.map((l) => l.logisticsTotal), currency);
  const serviceTotal = sum(options.lines.map((l) => l.serviceTotal), currency);

  const total = sum(
    [productsTotal, customizationTotal, shippingTotal, logisticsTotal, serviceTotal],
    currency,
  );

  const validUntil = new Date(now.getTime());
  validUntil.setUTCDate(validUntil.getUTCDate() + (options.validForDays ?? DEFAULT_VALIDITY_DAYS));

  // A single delivery estimate is only meaningful when every line has one —
  // "arrives in 12 days" alongside a line with no estimate is a promise about
  // the part Brandora cannot see.
  const estimates = options.lines.map((l) => l.deliveryEstimate);
  const deliveryEstimate = estimates.every((e) => e !== undefined && e !== "")
    ? estimates.join("; ")
    : undefined;

  return {
    id: newId("quote"),
    brandId: options.brand.id,
    packageId: options.package.id,
    reference: quoteReference(now, options.sequence ?? 1),
    currency,
    lines: quoteLines,
    productsTotal,
    customizationTotal,
    shippingTotal,
    logisticsTotal,
    serviceTotal,
    total,
    status: "draft",
    deliveryEstimate,
    validUntil: validUntil.toISOString(),
    createdAt: now.toISOString(),
  };
}

/**
 * The invariant: the category totals reconcile to the quote total, and the line
 * totals reconcile to the same figure.
 *
 * Exported rather than kept private because it is worth asserting in a test and
 * worth calling before a quote is sent — a rounding change three modules away
 * should fail here, not in front of a customer.
 */
export function quoteReconciles(quote: Quote): boolean {
  const categories = sum(
    [
      quote.productsTotal,
      quote.customizationTotal,
      quote.shippingTotal,
      quote.logisticsTotal,
      quote.serviceTotal,
    ],
    quote.currency,
  );
  const lines = sum(
    quote.lines.map((l) => l.total),
    quote.currency,
  );
  return categories.amount === quote.total.amount && lines.amount === quote.total.amount;
}

export const isExpired = (quote: Quote, now: Date = new Date()): boolean =>
  new Date(quote.validUntil).getTime() < now.getTime();

/* --- Status transitions -------------------------------------------------- */

const QUOTE_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ["sent", "expired"],
  sent: ["approved", "rejected", "expired"],
  approved: [],
  rejected: ["sent"],
  expired: ["sent"],
};

export function transitionQuote(quote: Quote, to: QuoteStatus, now: Date = new Date()): Quote {
  const allowed = QUOTE_TRANSITIONS[quote.status];
  if (!allowed.includes(to)) {
    throw new ValidationError("status", `a quote cannot go from ${quote.status} to ${to}`);
  }
  // Approving an expired quote would lock in a price Brandora may no longer be
  // able to buy at. Refuse, and let the interface offer a fresh one.
  if (to === "approved" && isExpired(quote, now)) {
    throw new BrandoraError("quote.expired", `quote ${quote.reference} expired on ${quote.validUntil}`, 409);
  }
  return { ...quote, status: to };
}

/* --- Rendering ----------------------------------------------------------- */

export interface QuoteRow {
  label: string;
  value: Money;
  /** Totals are emphasised; a subtotal that looks like a total misleads. */
  emphasis?: boolean;
}

/**
 * The quote as rows, ready for a page or a PDF.
 *
 * Zero-value categories are dropped: a line reading "Customisation: 0 FCFA" on a
 * quote for plain boxes invites the question "why is that there?", and every
 * question a quote raises is a delay.
 */
export function quoteRows(quote: Quote): QuoteRow[] {
  const rows: QuoteRow[] = [];
  const push = (label: string, value: Money): void => {
    if (value.amount !== 0) rows.push({ label, value });
  };
  push("Product costs", quote.productsTotal);
  push("Customisation", quote.customizationTotal);
  push("Shipping", quote.shippingTotal);
  push("Logistics", quote.logisticsTotal);
  push("Brandora service", quote.serviceTotal);
  rows.push({ label: "Total", value: quote.total, emphasis: true });
  return rows;
}

/** A deposit figure, for the flows where a founder pays in two parts. */
export function depositAmount(quote: Quote, rate = 0.5): Money {
  if (rate <= 0 || rate > 1) throw new ValidationError("rate", `deposit rate ${rate} is outside 0–1`);
  return money(Math.ceil(quote.total.amount * rate), quote.currency);
}

export const emptyTotal = (currency: CurrencyCode): Money => zero(currency);
