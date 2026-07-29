import type { Complexity, RiskLevel, Specialty } from "@harmony/shared";

/**
 * Pricing, implemented to the formulas in the Ultimate Build Prompt.
 *
 * Everything is integer cents and every output carries a breakdown, so a disputed
 * invoice or an expert querying a payout can be reconstructed line by line months
 * later. The multipliers are deliberately exported: these numbers are explicitly
 * "validate before locking in", and tuning them should be a one-line change, not a
 * hunt through the codebase.
 */

/* --- Seniority ---------------------------------------------------------- */

export const SENIORITY = ["junior", "standard", "senior"] as const;
export type Seniority = (typeof SENIORITY)[number];

/** TIER_BASE, in cents. */
export const TIER_BASE_CENTS: Record<Seniority, number> = {
  junior: 500,
  standard: 2_000,
  senior: 6_000,
};

/**
 * High complexity or High risk → senior. Medium complexity → standard.
 * Otherwise junior-eligible.
 *
 * This is also the guard behind the open question "are junior reviewers only
 * eligible for low-complexity/low-risk cases" — by construction, they are.
 */
export function inferSeniority(complexity: Complexity, risk: RiskLevel): Seniority {
  if (complexity === "high" || risk === "high") return "senior";
  if (complexity === "medium" || risk === "medium") return "standard";
  return "junior";
}

/** True when a junior reviewer may take this case at all. */
export const juniorEligible = (complexity: Complexity, risk: RiskLevel): boolean =>
  inferSeniority(complexity, risk) === "junior";

/* --- Multipliers -------------------------------------------------------- */

export type SpecialtyDemand = "low" | "standard" | "high";

/** Which specialties command a premium. Everything unlisted is standard demand. */
export const SPECIALTY_DEMAND: Record<Specialty, SpecialtyDemand> = {
  "general-medicine": "low",
  oncology: "high",
  cardiology: "high",
  radiology: "high",
  neurology: "standard",
  other: "standard",
};

export const SPECIALTY_MULT: Record<SpecialtyDemand, number> = {
  low: 0.7,
  standard: 1.0,
  high: 1.5,
};

export const COMPLEXITY_MULT: Record<Complexity, number> = {
  low: 1,
  medium: 1.5,
  high: 2.5,
};

export const RISK_MULT: Record<RiskLevel, number> = {
  low: 1,
  medium: 1.2,
  high: 1.5,
};

export const PAYOUT_FLOOR_CENTS = 200; // $2
export const PAYOUT_CEILING_CENTS = 50_000; // $500

/* --- 6.1 Expert payout -------------------------------------------------- */

export interface PayoutInput {
  specialty: Specialty;
  complexity: Complexity;
  risk: RiskLevel;
  /** Override the inferred tier — an admin reassigning a case, for example. */
  seniority?: Seniority;
}

export interface PayoutResult {
  payoutCents: number;
  seniority: Seniority;
  /** Before the floor and ceiling were applied — shows when a clamp bound. */
  rawCents: number;
  clamped: "floor" | "ceiling" | null;
  breakdown: string[];
}

export function expertPayout(input: PayoutInput): PayoutResult {
  const seniority = input.seniority ?? inferSeniority(input.complexity, input.risk);
  const base = TIER_BASE_CENTS[seniority];
  const demand = SPECIALTY_DEMAND[input.specialty];
  const sMult = SPECIALTY_MULT[demand];
  const cMult = COMPLEXITY_MULT[input.complexity];
  const rMult = RISK_MULT[input.risk];

  const rawCents = Math.round(base * sMult * cMult * rMult);
  const payoutCents = clamp(rawCents, PAYOUT_FLOOR_CENTS, PAYOUT_CEILING_CENTS);
  const clamped =
    rawCents < PAYOUT_FLOOR_CENTS ? "floor" : rawCents > PAYOUT_CEILING_CENTS ? "ceiling" : null;

  const breakdown = [
    `Tier ${seniority}: ${money(base)}`,
    `Specialty ${input.specialty} (${demand} demand): ×${sMult}`,
    `Complexity ${input.complexity}: ×${cMult}`,
    `Risk ${input.risk}: ×${rMult}`,
    clamped === "floor"
      ? `Raised to the ${money(PAYOUT_FLOOR_CENTS)} floor (from ${money(rawCents)})`
      : clamped === "ceiling"
        ? `Capped at the ${money(PAYOUT_CEILING_CENTS)} ceiling (from ${money(rawCents)})`
        : `Expert payout: ${money(payoutCents)}`,
  ];

  return { payoutCents, seniority, rawCents, clamped, breakdown };
}

/* --- 6.2 Customer price ------------------------------------------------- */

/** Expert keeps 55%; Harmony's 45% funds matching, QA, infrastructure and support. */
export const EXPERT_SHARE = 0.55;
export const PRICE_FLOOR_CENTS = 1_000; // $10
export const DOUBLE_REVIEW_MULT = 1.8;
export const BATCH_DISCOUNT = 0.9;

export type ReviewMode = "single" | "double";

export interface PriceInput extends PayoutInput {
  reviewMode?: ReviewMode;
  /** Number of outputs in this submission. >1 earns the volume discount. */
  count?: number;
}

export interface PriceResult {
  priceCents: number;
  /** Per-review price before batch multiplication — what a simulator shows. */
  unitPriceCents: number;
  payout: PayoutResult;
  /** Harmony's gross margin on this sale, in cents. */
  marginCents: number;
  currency: "USD";
  breakdown: string[];
}

export function customerPrice(input: PriceInput): PriceResult {
  const payout = expertPayout(input);
  const mode = input.reviewMode ?? "single";
  const count = Math.max(1, Math.trunc(input.count ?? 1));

  let unit = Math.max(PRICE_FLOOR_CENTS, Math.round(payout.payoutCents / EXPERT_SHARE));
  const breakdown = [
    ...payout.breakdown,
    `Price = payout ÷ ${EXPERT_SHARE} (expert keeps ${pct(EXPERT_SHARE)}): ${money(unit)}`,
  ];

  if (mode === "double") {
    unit = Math.round(unit * DOUBLE_REVIEW_MULT);
    breakdown.push(`Double review (two independent experts): ×${DOUBLE_REVIEW_MULT} → ${money(unit)}`);
  }

  let priceCents = unit;
  if (count > 1) {
    priceCents = Math.round(unit * count * BATCH_DISCOUNT);
    breakdown.push(`Batch of ${count} with ${pct(1 - BATCH_DISCOUNT)} volume discount: ${money(priceCents)}`);
  }

  // Two experts are paid on a double review, so margin must account for both.
  const totalPayout = payout.payoutCents * (mode === "double" ? 2 : 1) * count;
  const marginCents = priceCents - totalPayout;

  breakdown.push(`Total: ${money(priceCents)} · expert cost ${money(totalPayout)} · margin ${money(marginCents)}`);

  return { priceCents, unitPriceCents: unit, payout, marginCents, currency: "USD", breakdown };
}

/* --- 6.3 Continuous monitoring ------------------------------------------ */

export const MONITORING_BASE_CENTS = 50_000; // $500/month
export const PER_REQUEST_CENTS = 1; // $0.01

export const MONITORING_RISK_MULT: Record<RiskLevel, number> = { low: 1, medium: 2, high: 5 };
export const COMPLIANCE_MULT = { detection: 1, audit: 3 } as const;
export const MODEL_MULT = { chatbot: 1, agent: 1.5 } as const;
export const LATENCY_MULT = { batch: 1, realtime: 2 } as const;

export interface MonitoringInput {
  requestsPerDay: number;
  risk: RiskLevel;
  compliance: keyof typeof COMPLIANCE_MULT;
  model: keyof typeof MODEL_MULT;
  latency: keyof typeof LATENCY_MULT;
}

export interface MonitoringResult {
  monthlyCents: number;
  baseCents: number;
  volumeCents: number;
  currency: "USD";
  breakdown: string[];
}

export function monitoringPrice(input: MonitoringInput): MonitoringResult {
  const requests = Math.max(0, Math.trunc(input.requestsPerDay)) * 30;
  const multiplier =
    MONITORING_RISK_MULT[input.risk] *
    COMPLIANCE_MULT[input.compliance] *
    MODEL_MULT[input.model] *
    LATENCY_MULT[input.latency];

  const volumeCents = Math.round(requests * PER_REQUEST_CENTS * multiplier);
  const monthlyCents = MONITORING_BASE_CENTS + volumeCents;

  return {
    monthlyCents,
    baseCents: MONITORING_BASE_CENTS,
    volumeCents,
    currency: "USD",
    breakdown: [
      `Base platform fee: ${money(MONITORING_BASE_CENTS)}/month`,
      `${input.requestsPerDay.toLocaleString("en-US")} requests/day × 30 = ${requests.toLocaleString("en-US")} monitored outputs`,
      `Risk ${input.risk} ×${MONITORING_RISK_MULT[input.risk]} · ${input.compliance} ×${COMPLIANCE_MULT[input.compliance]} · ${input.model} ×${MODEL_MULT[input.model]} · ${input.latency} ×${LATENCY_MULT[input.latency]}`,
      `Volume component: ${money(volumeCents)}`,
      `Total: ${money(monthlyCents)}/month`,
    ],
  };
}

/* --- 6.4 Dataset licensing ---------------------------------------------- */

export const RESALE_MULTIPLIER = 2.5;

export const PACKAGE_TIERS = {
  starter: { examples: 50, discount: 1.0 },
  growth: { examples: 500, discount: 0.7 },
  enterprise: { examples: 10_000, discount: 0.4 },
} as const;

export type PackageTier = keyof typeof PACKAGE_TIERS;

export interface DatasetInput {
  /** Blended average payout across junior/standard/senior for this specialty. */
  avgExpertPayoutCents: number;
  tier: PackageTier;
  resaleMultiplier?: number;
  /** Override the tier's example count for a bespoke package. */
  examples?: number;
}

export interface DatasetResult {
  unitPriceCents: number;
  examples: number;
  totalCents: number;
  currency: "USD";
  breakdown: string[];
}

export function datasetPrice(input: DatasetInput): DatasetResult {
  const multiplier = input.resaleMultiplier ?? RESALE_MULTIPLIER;
  const tier = PACKAGE_TIERS[input.tier];
  const examples = input.examples ?? tier.examples;

  const unitPriceCents = Math.round(input.avgExpertPayoutCents * multiplier);
  const totalCents = Math.round(unitPriceCents * examples * tier.discount);

  return {
    unitPriceCents,
    examples,
    totalCents,
    currency: "USD",
    breakdown: [
      `Blended expert payout: ${money(input.avgExpertPayoutCents)}`,
      `Resale multiplier ×${multiplier} → unit price ${money(unitPriceCents)}`,
      `${input.tier} package: ${examples.toLocaleString("en-US")} examples × ${tier.discount} discount`,
      `Total: ${money(totalCents)}`,
    ],
  };
}

/** Blended average payout across the three tiers, for dataset pricing. */
export function blendedPayoutCents(specialty: Specialty, complexity: Complexity = "medium", risk: RiskLevel = "medium"): number {
  const tiers = SENIORITY.map(
    (seniority) => expertPayout({ specialty, complexity, risk, seniority }).payoutCents,
  );
  return Math.round(tiers.reduce((a, b) => a + b, 0) / tiers.length);
}

/* --- SLA ---------------------------------------------------------------- */

const BASE_SLA_HOURS: Record<Complexity, number> = { low: 24, medium: 48, high: 72 };
const RISK_SLA_FACTOR: Record<RiskLevel, number> = { low: 1, medium: 0.6, high: 0.3 };
export const MIN_SLA_HOURS = 2;

/** Turnaround in hours. Higher risk compresses it; never below the floor. */
export function slaHours(complexity: Complexity, risk: RiskLevel, mode: ReviewMode = "single"): number {
  const raw = BASE_SLA_HOURS[complexity] * RISK_SLA_FACTOR[risk] * (mode === "double" ? 1.5 : 1);
  return Math.max(MIN_SLA_HOURS, Math.round(raw));
}

export const etaFrom = (now: Date, hours: number): Date =>
  new Date(now.getTime() + hours * 3_600_000);

/* --- Helpers ------------------------------------------------------------ */

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const money = (cents: number): string =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pct = (ratio: number): string => `${Math.round(ratio * 100)}%`;
