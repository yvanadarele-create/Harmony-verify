/**
 * Currency conversion at the supplier boundary.
 *
 * This module exists because of a bug waiting to happen. Suppliers quote in USD.
 * Brandora quotes in FCFA. `620` in one is not `620` in the other — it is roughly
 * a 600× difference — and a system that treats a supplier price as a customer
 * price produces quotes that are wrong by two orders of magnitude in the
 * direction that loses money on every order.
 *
 * So conversion is explicit and mandatory: `SupplierOffer.unitCost` is only ever
 * constructed through a rate source, and there is no code path that adopts a
 * supplier's number without one.
 *
 * The rates are injected rather than fetched here. A quote must be reproducible
 * months later during a dispute, which means the rate used has to be recorded
 * with the quote, not looked up again.
 */

import { type CurrencyCode, type Money, ValidationError, money } from "@brandora/shared";
import { CURRENCY_EXPONENT } from "@brandora/shared";

export interface RateSource {
  /** Units of `to` per one unit of `from`. */
  rate(from: CurrencyCode, to: CurrencyCode): number;
  /** When these rates were captured, recorded against the quote. */
  readonly asOf: string;
}

/**
 * A fixed table, for development, tests and the offline fallback.
 *
 * The XOF peg to the euro is fixed by treaty at 655.957, so that one is a
 * constant rather than a rate. Everything else is indicative and must be
 * replaced by a live source before real money moves — which is why this class
 * is named for what it is rather than called `DefaultRateSource`.
 */
export class FixedRateSource implements RateSource {
  /** Value of one unit of the currency, in XOF. */
  private static readonly IN_XOF: Record<CurrencyCode, number> = {
    XOF: 1,
    EUR: 655.957,
    USD: 605,
    GBP: 765,
    NGN: 0.4,
    GHS: 42,
    MAD: 60,
    ZAR: 33,
  };

  constructor(readonly asOf: string = "2026-01-01T00:00:00.000Z") {}

  rate(from: CurrencyCode, to: CurrencyCode): number {
    if (from === to) return 1;
    const fromXof = FixedRateSource.IN_XOF[from];
    const toXof = FixedRateSource.IN_XOF[to];
    if (!fromXof || !toXof) throw new ValidationError("currency", `no rate for ${from}→${to}`);
    return fromXof / toXof;
  }
}

/**
 * Convert, respecting each currency's minor-unit exponent.
 *
 * The exponent step is the part that is easy to miss: 12.50 USD is 1250 minor
 * units, and the XOF equivalent is 7563 minor units — not 756 250. Going through
 * major units in the middle keeps the arithmetic honest.
 */
export function convert(value: Money, to: CurrencyCode, rates: RateSource): Money {
  if (value.currency === to) return value;
  const major = value.amount / 10 ** CURRENCY_EXPONENT[value.currency];
  const converted = major * rates.rate(value.currency, to);
  return money(Math.round(converted * 10 ** CURRENCY_EXPONENT[to]), to);
}

/** Parse a supplier's price string into Money in its own currency. */
export function parseSupplierAmount(raw: string | number | undefined, currency: CurrencyCode): Money {
  const numeric = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? "").replace(/[^0-9.\-]/g, ""));
  if (!Number.isFinite(numeric)) {
    throw new ValidationError("price", `supplier returned an unparseable amount: ${String(raw)}`);
  }
  return money(Math.round(numeric * 10 ** CURRENCY_EXPONENT[currency]), currency);
}
