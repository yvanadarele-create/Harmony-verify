/**
 * Partner application evaluation.
 *
 * Two audiences, and the split between them is the point of this module. The
 * applicant sees five compatibility dimensions. Harmony sees nine, plus revenue
 * opportunity, strategic impact and outreach tier. `publicView()` is the only
 * function that produces an applicant-facing payload, and it is built by naming
 * the five public fields rather than by deleting the private ones — a scoring
 * dimension added later cannot leak by being forgotten.
 */

export const PRIVATE_DIMENSIONS = [
  "strategicAlignment",
  "technicalCompatibility",
  "businessPotential",
  "revenuePotential",
  "trustCompliance",
  "dataQuality",
  "longTermValue",
  "innovationScore",
  "riskScore",
] as const;

export type PrivateDimension = (typeof PRIVATE_DIMENSIONS)[number];
export type PrivateScores = Record<PrivateDimension, number>;

export const PRIVATE_DIMENSION_LABELS: Record<PrivateDimension, string> = {
  strategicAlignment: "Strategic alignment with clinical AI safety",
  technicalCompatibility: "API maturity, data formats, infrastructure readiness",
  businessPotential: "Licensing, enterprise and API revenue",
  revenuePotential: "Direct revenue impact",
  trustCompliance: "Reputation, regulatory standing, clinical credibility",
  dataQuality: "Value of datasets and expert networks",
  longTermValue: "Multi-year strategic potential",
  innovationScore: "Technology and approach",
  riskScore: "Risk exposure (0 low → 100 high)",
};

/* --- Thresholds ---------------------------------------------------------- */

export const RISK_LOW_BELOW = 35;
export const RISK_HIGH_ABOVE = 65;

export const APPROVED_AT = 85;
export const APPROVED_WITH_RECOMMENDATIONS_AT = 75;
export const UNDER_REVIEW_AT = 60;
export const NOT_A_CURRENT_FIT_AT = 40;

export type PartnerRiskLevel = "Low" | "Medium" | "High";

export type Recommendation =
  | "approved"
  | "approved_with_recommendations"
  | "under_review"
  | "not_a_current_fit"
  | "declined";

export const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  approved: "Approved",
  approved_with_recommendations: "Approved with recommendations",
  under_review: "Under review",
  not_a_current_fit: "Not a current fit",
  declined: "Declined",
};

/* --- Input --------------------------------------------------------------- */

export interface PartnerApplication {
  companyName?: string | null;
  workEmail?: string | null;
  website?: string | null;
  partnershipType?: string | null;
  description?: string | null;
  agreesPartnershipAgreement: boolean;
  agreesConfidentiality: boolean;
}

export interface PartnerEvaluation {
  /** Null when a prerequisite failed — nothing is scored in that case. */
  privateScores: PrivateScores | null;
  riskLevel: PartnerRiskLevel;
  publicScores: PublicScores;
  overallCompatibility: number;
  recommendation: Recommendation;
  rationale: string;
  /** Failed prerequisites. Empty when the application was scoreable. */
  missingPrerequisites: string[];
  internal: InternalAssessment;
}

export interface PublicScores {
  strategicAlignment: number;
  technicalFit: number;
  businessPotential: number;
  complianceReadiness: number;
  innovation: number;
}

/** Never rendered to an applicant. Admin console and CRM only. */
export interface InternalAssessment {
  revenueOpportunityUsd: number;
  strategicImpact: "Low" | "Medium" | "High";
  priorityTier: "tier_1" | "tier_2" | "tier_3";
  accountManager: string;
}

/* --- Prerequisites ------------------------------------------------------- */

const present = (v: string | null | undefined): boolean => Boolean(v && v.trim().length > 1);

/**
 * Four hard prerequisites. Two are identity, two are consent — and the consent
 * pair is not a formality: partner evaluation involves commercially sensitive
 * information in both directions, so an application without confidentiality
 * agreed is not a weak application, it is one we are not permitted to assess.
 */
export function missingPrerequisites(app: PartnerApplication): string[] {
  const missing: string[] = [];
  if (!present(app.companyName)) missing.push("Company name is required.");
  if (!present(app.workEmail) || !app.workEmail!.includes("@")) {
    missing.push("A work email address is required.");
  }
  if (!app.agreesPartnershipAgreement) missing.push("The partnership agreement must be accepted.");
  if (!app.agreesConfidentiality) missing.push("The confidentiality undertaking must be accepted.");
  return missing;
}

/* --- Derivation ---------------------------------------------------------- */

const clamp100 = (n: number): number => Math.min(100, Math.max(0, Math.round(n)));

export function riskLevelFor(riskScore: number): PartnerRiskLevel {
  if (riskScore < RISK_LOW_BELOW) return "Low";
  if (riskScore > RISK_HIGH_ABOVE) return "High";
  return "Medium";
}

/**
 * The five public dimensions, derived from the nine private ones.
 *
 * Business potential is the mean of the two commercial dimensions, which is what
 * keeps revenue expectations from being separately visible: an applicant can see
 * that their commercial fit scored 62, not what we think they are worth.
 */
export function publicScoresFrom(scores: PrivateScores): PublicScores {
  return {
    strategicAlignment: clamp100(scores.strategicAlignment),
    technicalFit: clamp100(scores.technicalCompatibility),
    businessPotential: clamp100((scores.businessPotential + scores.revenuePotential) / 2),
    complianceReadiness: clamp100(scores.trustCompliance),
    innovation: clamp100(scores.innovationScore),
  };
}

export function overallCompatibility(publicScores: PublicScores): number {
  const values = Object.values(publicScores);
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * High risk declines regardless of compatibility.
 *
 * Order matters here and is not the order the tiers are listed in. Checking
 * `declined` first is the only reading under which "or risk = High" has any
 * effect — evaluate the tiers top-down and a high-risk applicant scoring 70
 * would land in `under_review`, which is exactly the outcome the risk dimension
 * exists to prevent.
 */
export function recommendationFor(overall: number, risk: PartnerRiskLevel): Recommendation {
  if (risk === "High" || overall < NOT_A_CURRENT_FIT_AT) return "declined";
  if (overall >= APPROVED_AT && risk === "Low") return "approved";
  if (overall >= APPROVED_WITH_RECOMMENDATIONS_AT) return "approved_with_recommendations";
  if (overall >= UNDER_REVIEW_AT) return "under_review";
  return "not_a_current_fit";
}

function internalAssessment(scores: PrivateScores, overall: number, risk: PartnerRiskLevel): InternalAssessment {
  // Order-of-magnitude estimate for pipeline triage, not a forecast.
  const revenueOpportunityUsd = Math.round((scores.revenuePotential / 100) * 250_000);
  const strategicImpact =
    scores.strategicAlignment >= 75 && scores.longTermValue >= 70
      ? "High"
      : scores.strategicAlignment >= 50
        ? "Medium"
        : "Low";
  const priorityTier =
    overall >= APPROVED_AT && risk !== "High" ? "tier_1" : overall >= UNDER_REVIEW_AT ? "tier_2" : "tier_3";

  return {
    revenueOpportunityUsd,
    strategicImpact,
    priorityTier,
    accountManager: priorityTier === "tier_1" ? "Founder-led" : "Partnerships queue",
  };
}

const ZERO_SCORES: PrivateScores = Object.fromEntries(
  PRIVATE_DIMENSIONS.map((d) => [d, 0]),
) as PrivateScores;

/* --- Evaluation ---------------------------------------------------------- */

/**
 * `scores` come from the partner engine — a model with access to the application
 * and public company information. As with experts, the model proposes numbers and
 * the thresholds here decide the outcome.
 */
export function evaluatePartner(app: PartnerApplication, scores: PrivateScores): PartnerEvaluation {
  const missing = missingPrerequisites(app);

  if (missing.length > 0) {
    return {
      privateScores: null,
      riskLevel: "High",
      publicScores: { strategicAlignment: 0, technicalFit: 0, businessPotential: 0, complianceReadiness: 0, innovation: 0 },
      overallCompatibility: 0,
      recommendation: "declined",
      rationale: missing[0]!,
      missingPrerequisites: missing,
      internal: internalAssessment(ZERO_SCORES, 0, "High"),
    };
  }

  const normalised = Object.fromEntries(
    PRIVATE_DIMENSIONS.map((d) => [d, clamp100(scores[d] ?? 0)]),
  ) as PrivateScores;

  const risk = riskLevelFor(normalised.riskScore);
  const publicScores = publicScoresFrom(normalised);
  const overall = overallCompatibility(publicScores);
  const recommendation = recommendationFor(overall, risk);

  return {
    privateScores: normalised,
    riskLevel: risk,
    publicScores,
    overallCompatibility: overall,
    recommendation,
    rationale: rationaleFor(recommendation, overall, risk),
    missingPrerequisites: [],
    internal: internalAssessment(normalised, overall, risk),
  };
}

function rationaleFor(recommendation: Recommendation, overall: number, risk: PartnerRiskLevel): string {
  switch (recommendation) {
    case "approved":
      return `Compatibility ${overall}/100 with low risk exposure.`;
    case "approved_with_recommendations":
      return `Compatibility ${overall}/100 — strong fit with specific areas to address before integration.`;
    case "under_review":
      return `Compatibility ${overall}/100 — viable, pending further diligence.`;
    case "not_a_current_fit":
      return `Compatibility ${overall}/100 — below the threshold for a partnership at this stage.`;
    case "declined":
      return risk === "High"
        ? `Risk assessment returned High, which declines the application independently of the ${overall}/100 compatibility score.`
        : `Compatibility ${overall}/100 is below the ${NOT_A_CURRENT_FIT_AT}/100 minimum.`;
  }
}

/* --- Applicant-facing view ----------------------------------------------- */

export interface PartnerPublicView {
  overallCompatibility: number;
  recommendation: Recommendation;
  recommendationLabel: string;
  dimensions: { label: string; score: number }[];
  message: string;
}

/**
 * The only shape that may be sent to an applicant.
 *
 * Built by enumerating the five public fields. Nothing private can reach this
 * payload by omission, and the test suite asserts that no private dimension name
 * or value appears in its serialised form.
 */
export function publicView(evaluation: PartnerEvaluation): PartnerPublicView {
  const p = evaluation.publicScores;
  return {
    overallCompatibility: evaluation.overallCompatibility,
    recommendation: evaluation.recommendation,
    recommendationLabel: RECOMMENDATION_LABELS[evaluation.recommendation],
    dimensions: [
      { label: "Strategic alignment", score: p.strategicAlignment },
      { label: "Technical fit", score: p.technicalFit },
      { label: "Business potential", score: p.businessPotential },
      { label: "Compliance readiness", score: p.complianceReadiness },
      { label: "Innovation", score: p.innovation },
    ],
    message: applicantMessage(evaluation),
  };
}

function applicantMessage(evaluation: PartnerEvaluation): string {
  if (evaluation.missingPrerequisites.length > 0) {
    return `We could not assess this application: ${evaluation.missingPrerequisites.join(" ")}`;
  }
  switch (evaluation.recommendation) {
    case "approved":
      return "Your application has been approved. Our partnerships team will contact you to schedule integration planning.";
    case "approved_with_recommendations":
      return "Your application has been approved with recommendations. We will share the specific areas to address when we meet.";
    case "under_review":
      return "Your application is under review. We may come back to you for further detail.";
    case "not_a_current_fit":
      return "Your application is not a fit for our current partner programme. We would welcome a fresh application as your platform develops.";
    case "declined":
      return "We are not able to proceed with this partnership at this time.";
  }
}
