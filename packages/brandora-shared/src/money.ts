/**
 * Money for Brandora.
 *
 * Two decisions drive everything in this file.
 *
 * First, every amount is an integer in the currency's *minor unit*. Floating
 * point money accumulates error, and a quote that is off by a hundredth after
 * eight line items is a quote a customer can dispute.
 *
 * Second, the minor unit is not always a hundredth. Brandora launches in
 * FCFA/XOF, which has **no** decimal places — 1 XOF is one minor unit, not one
 * hundred. A codebase that assumes `cents = amount * 100` silently multiplies
 * every West African price by a hundred. So the exponent is a property of the
 * currency, looked up here, and `DEFAULT_CURRENCY` is a single constant rather
 * than an assumption spread through the application (spec §24).
 */

export const CURRENCIES = ["XOF", "USD", "EUR", "GBP", "NGN", "GHS", "MAD", "ZAR"] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

/**
 * Digits after the decimal point, per ISO 4217. XOF, XAF and the other CFA
 * currencies are zero-decimal; most of the rest are two.
 */
export const CURRENCY_EXPONENT: Record<CurrencyCode, number> = {
  XOF: 0,
  USD: 2,
  EUR: 2,
  GBP: 2,
  NGN: 2,
  GHS: 2,
  MAD: 2,
  ZAR: 2,
};

/** What a person actually calls the currency in the interface. */
export const CURRENCY_SYMBOL: Record<CurrencyCode, string> = {
  XOF: "FCFA",
  USD: "$",
  EUR: "€",
  GBP: "£",
  NGN: "₦",
  GHS: "GH₵",
  MAD: "MAD",
  ZAR: "R",
};

/**
 * The launch currency. Changing this one line changes the application's default;
 * nothing else hard-codes FCFA.
 */
export const DEFAULT_CURRENCY: CurrencyCode = "XOF";

export interface Money {
  /** Integer, in the currency's minor unit. */
  readonly amount: number;
  readonly currency: CurrencyCode;
}

export function isCurrency(value: string): value is CurrencyCode {
  return (CURRENCIES as readonly string[]).includes(value);
}

export class CurrencyMismatchError extends Error {
  constructor(a: CurrencyCode, b: CurrencyCode) {
    super(`Cannot combine ${a} and ${b}. Convert to one currency first.`);
    this.name = "CurrencyMismatchError";
  }
}

/** Construct from minor units. Throws on a non-integer, which is always a bug. */
export function money(amount: number, currency: CurrencyCode = DEFAULT_CURRENCY): Money {
  if (!Number.isInteger(amount)) {
    throw new RangeError(`Money must be an integer number of minor units, got ${amount}`);
  }
  return { amount, currency };
}

export const zero = (currency: CurrencyCode = DEFAULT_CURRENCY): Money => money(0, currency);

/** Construct from a major-unit figure — "1 500 FCFA", "12.50 USD". */
export function fromMajor(major: number, currency: CurrencyCode = DEFAULT_CURRENCY): Money {
  const factor = 10 ** CURRENCY_EXPONENT[currency];
  return money(Math.round(major * factor), currency);
}

export function toMajor(value: Money): number {
  return value.amount / 10 ** CURRENCY_EXPONENT[value.currency];
}

function sameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

export function add(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

export function sum(values: readonly Money[], currency: CurrencyCode = DEFAULT_CURRENCY): Money {
  return values.reduce<Money>((acc, v) => add(acc, v), zero(currency));
}

/** Multiply by a quantity or a rate. Rounds half-up to a whole minor unit. */
export function multiply(value: Money, factor: number): Money {
  return money(Math.round(value.amount * factor), value.currency);
}

export function compare(a: Money, b: Money): number {
  sameCurrency(a, b);
  return a.amount - b.amount;
}

export const isZero = (value: Money): boolean => value.amount === 0;

/**
 * Round up to a "shelf-friendly" figure so a quote reads like a price rather
 * than a calculation. 14 730 FCFA becomes 14 800; 12.37 USD becomes 12.40.
 * Always rounds *up*, so rounding never eats into margin.
 */
export function roundUpTo(value: Money, step: number): Money {
  if (step <= 0) return value;
  return money(Math.ceil(value.amount / step) * step, value.currency);
}

/**
 * Split an amount across n shares without losing or inventing a minor unit —
 * the remainder is distributed one unit at a time across the first shares.
 */
export function allocate(value: Money, shares: number): Money[] {
  if (shares < 1) throw new RangeError("Cannot allocate across fewer than one share");
  const base = Math.trunc(value.amount / shares);
  let remainder = value.amount - base * shares;
  const out: Money[] = [];
  for (let i = 0; i < shares; i += 1) {
    const extra = remainder > 0 ? 1 : remainder < 0 ? -1 : 0;
    remainder -= extra;
    out.push(money(base + extra, value.currency));
  }
  return out;
}

const BCP47: Record<string, string> = { en: "en-GB", fr: "fr-FR", es: "es-ES" };

/**
 * Render for a human, in their language.
 *
 * `Intl.NumberFormat` already knows that XOF takes no decimals and that French
 * groups with a narrow space, so this defers to it and only supplies the symbol
 * Brandora prefers ("FCFA" rather than the technically-correct "F CFA").
 */
export function formatMoney(value: Money, locale = "en"): string {
  const tag = BCP47[locale] ?? locale;
  const digits = CURRENCY_EXPONENT[value.currency];
  const figure = new Intl.NumberFormat(tag, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(toMajor(value));
  const symbol = CURRENCY_SYMBOL[value.currency];
  // Currencies written with a leading glyph lead; word-like codes trail.
  return symbol.length <= 2 ? `${symbol}${figure}` : `${figure} ${symbol}`;
}
