import type { Specialty } from "@harmony/shared";

/**
 * Expert application review.
 *
 * The decision is deterministic and reproducible: given the same application, it
 * returns the same verdict, with the score for every dimension and the rule that
 * decided it. A medical credentialling decision that cannot be explained after the
 * fact is not a credentialling decision, it is a guess — so nothing here is a black
 * box, and the whole evaluation is safe to attach to an audit record.
 *
 * A language model may *supply* dimension scores for the qualitative dimensions
 * (see `applyModelScores`), but it never renders the verdict. The gates below do.
 */

export const EXPERT_DIMENSIONS = [
  "credentialsCompleteness",
  "experienceLevel",
  "licenseValidity",
  "institutionCredibility",
  "specialtyClarity",
  "bioQuality",
  "professionalPresence",
  "motivationAvailability",
] as const;

export type ExpertDimension = (typeof EXPERT_DIMENSIONS)[number];

export const EXPERT_DIMENSION_LABELS: Record<ExpertDimension, string> = {
  credentialsCompleteness: "Credentials completeness",
  experienceLevel: "Experience level",
  licenseValidity: "License validity",
  institutionCredibility: "Institution credibility",
  specialtyClarity: "Specialty clarity",
  bioQuality: "Bio quality",
  professionalPresence: "Professional presence",
  motivationAvailability: "Motivation and availability",
};

/* --- Thresholds ---------------------------------------------------------- */

export const MIN_YEARS_EXPERIENCE = 3;
export const APPROVE_AVERAGE = 6.0;
export const REJECT_AVERAGE = 5.0;

/** Values that are technically non-empty but carry no information. */
const NULL_ANSWERS = new Set(["n/a", "na", "none", "nil", "-", "--", "tbd", "pending", "unknown"]);

const meaningful = (value: string | null | undefined): boolean => {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length < 2) return false;
  return !NULL_ANSWERS.has(trimmed.toLowerCase());
};

/* --- Input --------------------------------------------------------------- */

export interface ExpertApplication {
  name: string;
  email: string;
  specialty: Specialty | string;
  subSpecialty?: string | null;
  /** Board certifications, fellowships, degrees. */
  credentials?: string | null;
  yearsExperience: number;
  licenseNumber?: string | null;
  institution?: string | null;
  bio?: string | null;
  linkedinUrl?: string | null;
  orcidId?: string | null;
  cvUrl?: string | null;
  /** Hours per week the applicant says they can commit. */
  weeklyHours?: number | null;
  motivation?: string | null;
}

export type ExpertScores = Record<ExpertDimension, number>;

export interface ExpertDecision {
  decision: "approved" | "rejected";
  /** Set when the average landed in the 5.0–6.0 band: approved, but worth a human look. */
  borderline: boolean;
  scores: ExpertScores;
  average: number;
  /** The single rule that produced this decision, in plain language. */
  rationale: string;
  /** Every gate that failed. Empty on a clean approval. */
  blockers: string[];
  /** Specific, actionable notes sent to the applicant. */
  notes: string[];
  /** Status to write to `experts.status`. */
  nextStatus: "active" | "suspended";
}

/* --- Scoring ------------------------------------------------------------- */

const clamp10 = (n: number): number => Math.min(10, Math.max(1, Math.round(n)));

/**
 * Baseline scores derived from the structured fields alone — no model needed.
 *
 * Deliberately conservative on the qualitative dimensions (bio quality,
 * motivation): a heuristic can tell that a bio is 400 characters long, but not
 * that it is any good. It scores those in the middle and lets a reviewer or a
 * model move them, rather than manufacturing confidence it does not have.
 */
export function scoreExpertApplication(app: ExpertApplication): ExpertScores {
  const credentials = (app.credentials ?? "").trim();
  const bio = (app.bio ?? "").trim();
  const years = Number.isFinite(app.yearsExperience) ? Math.max(0, app.yearsExperience) : 0;

  // A named certification signals more than a job title does.
  const certSignals = /board|fellow|certif|diplomate|mrcp|frcp|facp|facc|md|do|phd|msc/i;
  const credentialsCompleteness = !meaningful(credentials)
    ? 1
    : clamp10(3 + (certSignals.test(credentials) ? 4 : 1) + Math.min(3, credentials.length / 60));

  // 3 years is the floor, 20+ is a full mark.
  const experienceLevel = years < MIN_YEARS_EXPERIENCE ? clamp10(years) : clamp10(3 + (years / 20) * 7);

  // Format is jurisdiction-specific, so this checks for presence and substance,
  // not shape. Real validation is a registry lookup, which is a human step.
  const licenseValidity = !meaningful(app.licenseNumber)
    ? 1
    : /[0-9]/.test(app.licenseNumber!) && app.licenseNumber!.trim().length >= 5
      ? 9
      : 5;

  const institutionSignals = /hospital|clinic|university|medical|health|centre|center|institute|nhs|chu/i;
  const institutionCredibility = !meaningful(app.institution)
    ? 1
    : institutionSignals.test(app.institution!)
      ? 9
      : 6;

  const specialtyClarity = !meaningful(String(app.specialty))
    ? 1
    : meaningful(app.subSpecialty)
      ? 9
      : 7;

  const bioQuality = !meaningful(bio) ? 1 : clamp10(3 + Math.min(4, bio.length / 150));

  // Either identifier is enough to verify a person exists; both is better.
  const identifiers = [meaningful(app.linkedinUrl), meaningful(app.orcidId), meaningful(app.cvUrl)].filter(
    Boolean,
  ).length;
  const professionalPresence = identifiers === 0 ? 2 : clamp10(4 + identifiers * 2);

  const hours = app.weeklyHours ?? 0;
  const motivationAvailability = clamp10(
    (meaningful(app.motivation) ? 5 : 3) + (hours >= 10 ? 4 : hours >= 5 ? 2 : hours > 0 ? 1 : 0),
  );

  return {
    credentialsCompleteness,
    experienceLevel,
    licenseValidity,
    institutionCredibility,
    specialtyClarity,
    bioQuality,
    professionalPresence,
    motivationAvailability,
  };
}

/**
 * Folds model-supplied scores over the baseline.
 *
 * Only the qualitative dimensions are overridable. A model cannot talk the
 * evaluation into believing a license number exists when the field is empty —
 * those dimensions are facts about the submitted data, and they stay that way.
 */
export const MODEL_SCORABLE: ReadonlySet<ExpertDimension> = new Set([
  "credentialsCompleteness",
  "institutionCredibility",
  "specialtyClarity",
  "bioQuality",
  "motivationAvailability",
]);

export function applyModelScores(
  baseline: ExpertScores,
  model: Partial<Record<ExpertDimension, number>>,
): ExpertScores {
  const merged = { ...baseline };
  for (const dimension of EXPERT_DIMENSIONS) {
    const proposed = model[dimension];
    if (proposed === undefined || !MODEL_SCORABLE.has(dimension)) continue;
    if (!Number.isFinite(proposed)) continue;
    merged[dimension] = clamp10(proposed);
  }
  return merged;
}

export const averageScore = (scores: ExpertScores): number => {
  const values = EXPERT_DIMENSIONS.map((d) => scores[d]);
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
};

/* --- Decision ------------------------------------------------------------ */

/**
 * Rejection gates are evaluated first and are absolute: no average, however high,
 * admits an applicant with no license number. The qualitative score can only
 * refuse an otherwise-qualified applicant, never rescue an unqualified one.
 */
export function reviewExpertApplication(
  app: ExpertApplication,
  modelScores?: Partial<Record<ExpertDimension, number>>,
): ExpertDecision {
  const scores = modelScores
    ? applyModelScores(scoreExpertApplication(app), modelScores)
    : scoreExpertApplication(app);
  const average = averageScore(scores);

  const blockers: string[] = [];
  if (!(app.yearsExperience >= MIN_YEARS_EXPERIENCE)) {
    blockers.push(
      `Fewer than ${MIN_YEARS_EXPERIENCE} years of post-qualification practice (stated: ${app.yearsExperience ?? 0}).`,
    );
  }
  if (!meaningful(app.licenseNumber)) blockers.push("No verifiable medical license number supplied.");
  if (!meaningful(app.institution)) blockers.push("No affiliated institution supplied.");
  if (average < REJECT_AVERAGE) {
    blockers.push(`Application score ${average.toFixed(2)}/10 is below the ${REJECT_AVERAGE.toFixed(1)} minimum.`);
  }

  const notes = weakDimensions(scores).map(
    (d) => `${EXPERT_DIMENSION_LABELS[d]} scored ${scores[d]}/10 — strengthen this before reapplying.`,
  );

  if (blockers.length > 0) {
    return {
      decision: "rejected",
      borderline: false,
      scores,
      average,
      rationale: blockers[0]!,
      blockers,
      notes,
      nextStatus: "suspended",
    };
  }

  const borderline = average < APPROVE_AVERAGE;
  return {
    decision: "approved",
    borderline,
    scores,
    average,
    rationale: borderline
      ? `All hard requirements met; score ${average.toFixed(2)}/10 sits in the ${REJECT_AVERAGE.toFixed(1)}–${APPROVE_AVERAGE.toFixed(1)} band — approved, flagged for a human second look.`
      : `All hard requirements met and score ${average.toFixed(2)}/10 is at or above the ${APPROVE_AVERAGE.toFixed(1)} threshold.`,
    blockers: [],
    notes,
    // 'active' is not the same as 'can be assigned work'. The agreement gate in
    // @harmony/database still holds until the expert signs, and the 2.5/5 rating
    // rule can move them back out of it later.
    nextStatus: "active",
  };
}

const weakDimensions = (scores: ExpertScores): ExpertDimension[] =>
  EXPERT_DIMENSIONS.filter((d) => scores[d] <= 4);

/* --- Applicant-facing summary -------------------------------------------- */

export interface ExpertOutcomeMessage {
  subject: string;
  headline: string;
  body: string[];
  /** Present only on approval — the agreement must be signed before any work. */
  nextSteps: string[];
}

/**
 * What the applicant is told. Rejections carry the actual reasons: a credentialled
 * clinician who is told only "unsuccessful" learns nothing and reapplies blind.
 */
export function expertOutcomeMessage(app: ExpertApplication, decision: ExpertDecision): ExpertOutcomeMessage {
  if (decision.decision === "approved") {
    return {
      subject: "Your Harmony Verify expert application has been approved",
      headline: `Welcome, ${app.name}.`,
      body: [
        "Your application has been reviewed and approved. Compensation is calculated per review, between $2 and $500, according to specialty, case complexity and clinical risk — the figure is shown before you accept any case.",
        "Reviews are assigned only after your Expert Agreement is signed.",
      ],
      nextSteps: [
        "Sign the Harmony Verify Expert Agreement.",
        "Complete your profile in the expert portal.",
        "Add payout details inside the portal — never by email.",
        "Maintain an average rating of 2.5/5 or above; falling below it deactivates the account.",
      ],
    };
  }

  return {
    subject: "Your Harmony Verify expert application",
    headline: `Thank you for applying, ${app.name}.`,
    body: [
      "We are not able to proceed with your application at this time. The specific reasons are below.",
      ...decision.blockers,
      ...decision.notes,
      "You are welcome to reapply once these are addressed.",
    ],
    nextSteps: [],
  };
}
