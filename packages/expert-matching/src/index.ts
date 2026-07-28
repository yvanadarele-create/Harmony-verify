import { NoEligibleExpertError } from "@harmony/shared";
import type { Expert, Specialty, VerificationAnalysis } from "@harmony/shared";

/**
 * Expert routing.
 *
 * Eligibility is a hard gate — an expert either may take a case or may not, and no
 * amount of high rating buys past a conflict of interest, a suspended licence or a
 * full caseload. Ranking only orders the reviewers who already qualify.
 */

export interface MatchInput {
  analysis: Pick<VerificationAnalysis, "specialty" | "recommendedExpert" | "risk">;
  experts: readonly Expert[];
  /** Customer's organisation, checked against each expert's declared conflicts. */
  customerOrganisation?: string;
}

export interface Candidate {
  expert: Expert;
  score: number;
  reasons: string[];
}

export interface MatchResult {
  matched: Expert;
  score: number;
  reasons: string[];
  runnersUp: Candidate[];
}

export interface Ineligible {
  expert: Expert;
  reason: string;
}

/** Why an expert cannot take this case, or `null` if they can. */
export function ineligibilityReason(
  expert: Expert,
  input: MatchInput,
): string | null {
  if (expert.status !== "active") return `status is ${expert.status}`;
  if (expert.availability === "unavailable") return "marked unavailable";
  if (expert.activeCaseCount >= expert.maxConcurrentCases) {
    return `at capacity (${expert.activeCaseCount}/${expert.maxConcurrentCases})`;
  }
  if (expert.specialty !== input.analysis.specialty) {
    return `specialty ${expert.specialty} does not match ${input.analysis.specialty}`;
  }
  if (expert.yearsExperience < input.analysis.recommendedExpert.minYearsExperience) {
    return `${expert.yearsExperience}y experience below the ${input.analysis.recommendedExpert.minYearsExperience}y required`;
  }
  // An unrated expert is not excluded by a rating floor — they have no history yet.
  if (
    expert.ratingCount > 0 &&
    expert.rating < input.analysis.recommendedExpert.minRating
  ) {
    return `rating ${expert.rating.toFixed(1)} below the ${input.analysis.recommendedExpert.minRating.toFixed(1)} required`;
  }
  if (input.customerOrganisation) {
    const org = input.customerOrganisation.trim().toLowerCase();
    if (expert.conflictsOfInterest.some((c) => c.trim().toLowerCase() === org)) {
      return `declared conflict of interest with ${input.customerOrganisation}`;
    }
  }
  return null;
}

/** Ranks an eligible expert. Higher is better. */
export function scoreCandidate(expert: Expert, input: MatchInput): Candidate {
  const reasons: string[] = [];
  let score = 0;

  // Rating dominates: review quality is the product.
  const ratingPoints = expert.ratingCount > 0 ? expert.rating * 10 : 30;
  score += ratingPoints;
  reasons.push(
    expert.ratingCount > 0
      ? `rating ${expert.rating.toFixed(1)} (${expert.ratingCount} reviews)`
      : "no rating history yet — treated as neutral",
  );

  // Experience, with diminishing returns past 20 years.
  const expPoints = Math.min(expert.yearsExperience, 20);
  score += expPoints;
  reasons.push(`${expert.yearsExperience} years experience`);

  // Prefer immediately available reviewers over merely busy ones.
  if (expert.availability === "available") {
    score += 15;
    reasons.push("available now");
  } else {
    reasons.push("currently busy");
  }

  // Spare capacity, so work spreads rather than piling on one person.
  const spare = expert.maxConcurrentCases - expert.activeCaseCount;
  const capacityPoints = (spare / expert.maxConcurrentCases) * 10;
  score += capacityPoints;
  reasons.push(`${spare} of ${expert.maxConcurrentCases} slots free`);

  // Sub-specialty alignment on high-risk cases.
  if (input.analysis.risk === "high" && expert.subSpecialty) {
    score += 5;
    reasons.push(`sub-specialty ${expert.subSpecialty}`);
  }

  return { expert, score: round2(score), reasons };
}

/**
 * Picks the best available reviewer.
 *
 * Throws NoEligibleExpertError — rather than returning a poor match — because
 * assigning a case to an unqualified or conflicted reviewer is worse than leaving it
 * queued for a human to route.
 */
export function matchExpert(input: MatchInput): MatchResult {
  const eligible: Expert[] = [];
  const rejected: Ineligible[] = [];

  for (const expert of input.experts) {
    const reason = ineligibilityReason(expert, input);
    if (reason) rejected.push({ expert, reason });
    else eligible.push(expert);
  }

  if (eligible.length === 0) {
    throw new NoEligibleExpertError(
      `No eligible ${input.analysis.specialty} reviewer is available for this case.`,
      {
        specialty: input.analysis.specialty,
        required: input.analysis.recommendedExpert,
        considered: input.experts.length,
        rejections: rejected.map((r) => ({ expertId: r.expert.id, reason: r.reason })),
      },
    );
  }

  const ranked = eligible
    .map((e) => scoreCandidate(e, input))
    .sort((a, b) => b.score - a.score || a.expert.id.localeCompare(b.expert.id));

  const [best, ...rest] = ranked;
  // Non-null: `eligible.length === 0` already returned above.
  const winner = best!;

  return {
    matched: winner.expert,
    score: winner.score,
    reasons: winner.reasons,
    runnersUp: rest.slice(0, 3),
  };
}

/** Everyone who could take a case in this specialty right now — for the admin console. */
export function availableIn(experts: readonly Expert[], specialty: Specialty): Expert[] {
  return experts.filter(
    (e) =>
      e.specialty === specialty &&
      e.status === "active" &&
      e.availability !== "unavailable" &&
      e.activeCaseCount < e.maxConcurrentCases,
  );
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
