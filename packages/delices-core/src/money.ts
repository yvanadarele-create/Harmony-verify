/**
 * Money handling.
 *
 * Amounts are integers in the currency's minor unit. The number of minor digits is
 * asked of `Intl` rather than assumed to be 2, so the same code is correct for EUR
 * (100 cents) and for XAF (no subdivision) — the currency is a setting, and Grace
 * may well not be billing in euros.
 */
import type { Minor } from "./types.js";

const digitsCache = new Map<string, number>();

export function minorDigits(currency: string): number {
  const cached = digitsCache.get(currency);
  if (cached !== undefined) return cached;
  let digits = 2;
  try {
    const resolved = new Intl.NumberFormat("fr-FR", { style: "currency", currency })
      .resolvedOptions().maximumFractionDigits;
    if (typeof resolved === "number") digits = resolved;
  } catch {
    digits = 2;
  }
  digitsCache.set(currency, digits);
  return digits;
}

/** "12,50" or "12.5" (as typed by a human) → minor units. */
export function parseAmount(input: string | number, currency: string): Minor | null {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * 10 ** minorDigits(currency));
  }
  const cleaned = input.replace(/\s/g, "").replace(",", ".");
  if (cleaned === "") return null;
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10 ** minorDigits(currency));
}

export function formatMoney(amount: Minor, currency: string, locale = "fr-FR"): string {
  const value = amount / 10 ** minorDigits(currency);
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
  } catch {
    return `${value.toFixed(minorDigits(currency))} ${currency}`;
  }
}

/** Line total for a basket item: base price plus the deltas of the chosen options. */
export function lineTotal(
  basePrice: Minor,
  optionDeltas: readonly Minor[],
  quantity: number,
): Minor {
  const unit = optionDeltas.reduce((sum, d) => sum + d, basePrice);
  return unit * quantity;
}
