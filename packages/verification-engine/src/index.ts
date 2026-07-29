import type {
  Priority,
  Review,
  Specialty,
  Submission,
  VerificationAnalysis,
} from "@harmony/shared";
import { customerPrice, slaHours, etaFrom, inferSeniority } from "@harmony/pricing-engine";
import { assessComplexity, assessRisk, detectSpecialty } from "./classify.js";

export * from "./classify.js";
export { scoreReport, summariseReport } from "./report.js";

/**
 * The analysis step of the verification pipeline.
 *
 * Takes a raw submission and works out what it is, how hard it is, how dangerous a
 * wrong answer would be, who should review it, and what it costs.
 */
export interface ProcessInput {
  content: string;
  /** What the customer selected. Detection can override it — see below. */
  declaredSpecialty: Specialty;
  reviewType: Submission["reviewType"];
  priority: Priority;
  now?: Date;
}

export function processVerificationRequest(input: ProcessInput): VerificationAnalysis {
  const rationale: string[] = [];

  /* Specialty ---------------------------------------------------------- */
  const detected = detectSpecialty(input.content);
  let specialty = input.declaredSpecialty;

  if (input.declaredSpecialty === "other" && detected.confidence >= 0.5) {
    // Customer did not know; detection is confident enough to route on.
    specialty = detected.specialty;
    rationale.push(
      `Specialty detected as ${specialty} (${detected.matched.slice(0, 3).join(", ")}).`,
    );
  } else if (
    detected.confidence >= 0.75 &&
    detected.specialty !== input.declaredSpecialty &&
    detected.specialty !== "other"
  ) {
    // Strong disagreement with the declared value. Flag it, but do not silently
    // override the customer — a mis-route is worse than a mislabel, and a human
    // can resolve this from the admin console.
    rationale.push(
      `Declared ${input.declaredSpecialty}, but content reads as ${detected.specialty} ` +
        `(${detected.matched.slice(0, 3).join(", ")}). Flagged for routing review.`,
    );
  } else {
    rationale.push(`Specialty ${specialty} as declared by the customer.`);
  }

  /* Complexity and risk ------------------------------------------------ */
  const c = assessComplexity(input.content);
  const r = assessRisk(input.content);

  rationale.push(
    c.reasons.length
      ? `Complexity ${c.complexity} (score ${c.score}): ${unique(c.reasons).slice(0, 4).join(", ")}.`
      : `Complexity ${c.complexity}: no escalating signals found.`,
  );
  rationale.push(
    r.reasons.length
      ? `Risk ${r.risk} (score ${r.score}): ${r.reasons.slice(0, 4).join(", ")}.`
      : `Risk ${r.risk}: no acute-harm signals found.`,
  );

  /* Reviewer requirements ---------------------------------------------- */
  // High risk or high complexity demands a more experienced, better-rated reviewer.
  const severe = r.risk === "high" || c.complexity === "high";
  const elevated = r.risk === "medium" || c.complexity === "medium";

  const recommendedExpert = {
    specialty,
    minYearsExperience: severe ? 10 : elevated ? 5 : 2,
    minRating: severe ? 4.5 : elevated ? 4.0 : 0,
  };
  rationale.push(
    `Requires a ${specialty} reviewer with ≥${recommendedExpert.minYearsExperience} years` +
      (recommendedExpert.minRating > 0
        ? ` and a rating of ≥${recommendedExpert.minRating.toFixed(1)}.`
        : "."),
  );

  /* Price and SLA ------------------------------------------------------ */
  // High risk is escalated a priority band regardless of what the customer picked —
  // we do not let a critical case sit in a standard queue.
  const effectivePriority: Priority =
    r.risk === "high" && input.priority === "standard" ? "urgent" : input.priority;

  if (effectivePriority !== input.priority) {
    rationale.push(
      `Priority raised from ${input.priority} to ${effectivePriority} because risk is high.`,
    );
  }

  const mode = input.reviewType === "deep-clinical-review" ? "double" : "single";
  const price = customerPrice({ specialty, complexity: c.complexity, risk: r.risk, reviewMode: mode });
  const hours = slaHours(c.complexity, r.risk, mode);

  rationale.push(
    `Seniority ${inferSeniority(c.complexity, r.risk)}; ` +
      `expert payout ${(price.payout.payoutCents / 100).toFixed(2)}, ` +
      `price ${(price.priceCents / 100).toFixed(2)}.`,
  );

  return {
    specialty,
    complexity: c.complexity,
    risk: r.risk,
    recommendedExpert,
    estimatedTimeHours: hours,
    estimatedPrice: { minCents: price.priceCents, maxCents: price.priceCents },
    rationale,
  };
}

/**
 * Pre-analysis estimate for the submission form's confirmation step, before
 * complexity and risk are known. Spans cheapest to dearest for the specialty.
 */
export function estimateBeforeAnalysis(
  specialty: Specialty,
  reviewType: Submission["reviewType"],
): VerificationAnalysis["estimatedPrice"] {
  const mode = reviewType === "deep-clinical-review" ? "double" : "single";
  return {
    minCents: customerPrice({ specialty, complexity: "low", risk: "low", reviewMode: mode }).priceCents,
    maxCents: customerPrice({ specialty, complexity: "high", risk: "high", reviewMode: mode }).priceCents,
  };
}

export function computeEta(now: Date, slaHours: number): string {
  return etaFrom(now, slaHours).toISOString();
}

/** A review is only complete when every required finding is present. */
export function isReviewComplete(review: Review): boolean {
  return (
    review.accuracy !== undefined &&
    review.hallucinationDetected !== undefined &&
    review.missingInformation !== undefined &&
    review.safetyLevel !== undefined &&
    review.clinicalReasoning !== undefined &&
    review.verdict !== undefined
  );
}

const unique = (xs: string[]): string[] => [...new Set(xs)];
