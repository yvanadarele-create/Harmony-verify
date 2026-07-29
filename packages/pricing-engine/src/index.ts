import type { Complexity, Priority, PriceQuote, ReviewType } from "@harmony/shared";

/**
 * Deterministic price and SLA calculation.
 *
 * All money is integer cents. Every component is additive and explained in the
 * returned breakdown, so a customer can see exactly what they are paying for and a
 * disputed invoice can be reconstructed months later.
 */

/** Base fee by review depth. */
const BASE_CENTS: Record<ReviewType, number> = {
  "single-verification": 14_900,
  "deep-clinical-review": 39_900,
  "continuous-monitoring": 89_900,
};

/** Complexity surcharge — more clinical surface for the reviewer to cover. */
const COMPLEXITY_CENTS: Record<Complexity, number> = {
  low: 0,
  medium: 6_000,
  high: 18_000,
};

/** Priority surcharge, as a percentage of the base fee. */
const PRIORITY_MULTIPLIER: Record<Priority, number> = {
  standard: 0,
  urgent: 0.4,
  critical: 1.0,
};

/** Base turnaround before priority compression. */
const BASE_SLA_HOURS: Record<ReviewType, number> = {
  "single-verification": 24,
  "deep-clinical-review": 72,
  "continuous-monitoring": 24,
};

const COMPLEXITY_SLA_HOURS: Record<Complexity, number> = {
  low: 0,
  medium: 8,
  high: 24,
};

/** Priority compresses turnaround. Never below the floor — a real clinician must read it. */
const PRIORITY_SLA_FACTOR: Record<Priority, number> = {
  standard: 1,
  urgent: 0.5,
  critical: 0.25,
};

const MIN_SLA_HOURS = 2;

export interface QuoteInput {
  reviewType: ReviewType;
  complexity: Complexity;
  priority: Priority;
}

export function quote({ reviewType, complexity, priority }: QuoteInput): PriceQuote {
  const baseCents = BASE_CENTS[reviewType];
  const complexityCents = COMPLEXITY_CENTS[complexity];
  const reviewTypeCents = 0; // folded into base; kept explicit for breakdown symmetry
  const priorityCents = Math.round(baseCents * PRIORITY_MULTIPLIER[priority]);

  const totalCents = baseCents + complexityCents + priorityCents + reviewTypeCents;

  const rawSla = (BASE_SLA_HOURS[reviewType] + COMPLEXITY_SLA_HOURS[complexity]) *
    PRIORITY_SLA_FACTOR[priority];
  const slaHours = Math.max(MIN_SLA_HOURS, Math.round(rawSla));

  const breakdown = [
    `Base — ${label(reviewType)}: ${fmt(baseCents)}`,
    complexityCents > 0
      ? `Complexity (${complexity}): +${fmt(complexityCents)}`
      : `Complexity (${complexity}): included`,
    priorityCents > 0
      ? `Priority (${priority}): +${fmt(priorityCents)}`
      : `Priority (standard): included`,
    `Total: ${fmt(totalCents)}`,
    `Turnaround: ${slaHours}h`,
  ];

  return {
    baseCents,
    complexityCents,
    priorityCents,
    reviewTypeCents,
    totalCents,
    currency: "USD",
    slaHours,
    breakdown,
  };
}

/**
 * Price band shown before analysis completes, when complexity is still unknown.
 * Spans the cheapest and dearest complexity for the chosen type and priority.
 */
export function quoteRange(
  reviewType: ReviewType,
  priority: Priority,
): { minCents: number; maxCents: number } {
  const low = quote({ reviewType, complexity: "low", priority }).totalCents;
  const high = quote({ reviewType, complexity: "high", priority }).totalCents;
  return { minCents: low, maxCents: high };
}

export function etaFrom(now: Date, slaHours: number): Date {
  return new Date(now.getTime() + slaHours * 3_600_000);
}

export const fmt = (cents: number): string =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const label = (t: ReviewType): string =>
  ({
    "single-verification": "single verification",
    "deep-clinical-review": "deep clinical review",
    "continuous-monitoring": "continuous monitoring",
  })[t];

export { BASE_CENTS, COMPLEXITY_CENTS, PRIORITY_MULTIPLIER, MIN_SLA_HOURS };
