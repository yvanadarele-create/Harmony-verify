import type { Review, Submission } from "@harmony/shared";

/**
 * Turns a completed verification into a dataset row.
 *
 * A finished review is already the rarest thing in medical AI evaluation: an
 * output, a clinician's judgement of it across six dimensions, and the corrected
 * version with a source. This module puts that into a stable, field-by-field
 * shape so the corpus is a by-product of work the customer already paid for
 * rather than a separate labelling operation.
 *
 * Two rules are enforced here rather than left to a caller's discipline:
 *
 *   1. **Consent is per submission and explicit.** `extract` returns null for a
 *      submission that was not opted in. There is no flag to override it and no
 *      "internal use" exception, because a dataset assembled from material the
 *      customer did not agree to is not an asset, it is a liability.
 *
 *   2. **De-identification runs before the row is built, not after.** A pipeline
 *      that stores the raw text and strips it later has a window in which the
 *      raw text exists in the corpus. This one never constructs that row.
 */

/* --- Row shape ------------------------------------------------------------ */

export interface DatasetRow {
  /** Stable, opaque identifier. Never the submission id — that links back. */
  id: string;

  /* Input */
  input: string;
  aiSystem: string | null;

  /* Classification */
  specialty: string;
  complexity: string | null;
  riskLevel: string | null;

  /* Expert labels — the part that cannot be produced automatically */
  accuracy: string | null;
  hallucinationDetected: boolean | null;
  hallucinationDetails: string | null;
  missingInformation: boolean | null;
  missingInformationDetails: string | null;
  safetyLevel: string | null;
  clinicalReasoning: string | null;
  verdict: string | null;

  /** The corrected content. The single most valuable field in the row. */
  correction: string | null;

  /* Provenance, without identity */
  reviewerSpecialty: string | null;
  reviewerYearsExperience: number | null;
  reviewedAt: string | null;

  /** Redactions applied, so a buyer can see what was removed and why. */
  redactions: string[];
}

export interface DatasetReviewer {
  specialty?: string | null;
  yearsExperience?: number | null;
}

export interface ExtractInput {
  submission: Submission & { datasetConsent?: boolean };
  review: Review;
  reviewer?: DatasetReviewer;
  /** Injected in tests so row ids are deterministic. */
  rowId?: () => string;
}

/* --- De-identification ---------------------------------------------------- */

/**
 * Patterns for identifiers that survive a customer's own de-identification.
 *
 * This is a safety net, not the primary control — customers are asked to
 * de-identify before sending, and the terms require it. But "asked to" is not a
 * mechanism, and the cost of a missed identifier reaching a licensed dataset is
 * high enough to justify a second pass that is deliberately over-eager.
 */
const REDACTORS: Array<{ label: string; pattern: RegExp; replacement: string }> = [
  { label: "email address", pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, replacement: "[EMAIL]" },
  {
    label: "phone number",
    pattern: /\b(?:\+\d{1,3}[\s-]?)?(?:\(\d{2,4}\)[\s-]?)?\d{3,4}[\s-]?\d{3,4}(?:[\s-]?\d{2,4})?\b(?=\D|$)/g,
    replacement: "[PHONE]",
  },
  { label: "national or record number", pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: "[ID]" },
  {
    label: "medical record number",
    pattern: /\b(?:MRN|NHS|record\s*(?:no|number|#))[:\s#]*[A-Z0-9-]{4,}\b/gi,
    replacement: "[MRN]",
  },
  { label: "date of birth", pattern: /\b(?:DOB|date of birth)[:\s]*[\d/.-]{6,10}\b/gi, replacement: "[DOB]" },
  {
    label: "full date",
    pattern: /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g,
    replacement: "[DATE]",
  },
  {
    label: "named person",
    // Titles are the reliable signal. A bare capitalised pair is as likely to be
    // a drug name or a hospital as a patient, and over-redacting those destroys
    // the clinical content the row exists for.
    pattern: /\b(?:Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/g,
    replacement: "[NAME]",
  },
  { label: "postcode", pattern: /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/g, replacement: "[POSTCODE]" },
];

export interface Deidentified {
  text: string;
  redactions: string[];
}

export function deidentify(text: string): Deidentified {
  let output = text;
  const redactions: string[] = [];

  for (const { label, pattern, replacement } of REDACTORS) {
    // Fresh lastIndex each pass: a /g regex reused across strings silently skips.
    pattern.lastIndex = 0;
    if (pattern.test(output)) {
      pattern.lastIndex = 0;
      output = output.replace(pattern, replacement);
      redactions.push(label);
    }
  }

  return { text: output, redactions };
}

/* --- Extraction ------------------------------------------------------------ */

/** Only a submitted review of a completed submission is dataset material. */
export function isExtractable(input: ExtractInput): boolean {
  return (
    input.submission.datasetConsent === true &&
    input.review.status === "submitted" &&
    input.submission.status === "completed"
  );
}

let counter = 0;
const defaultRowId = (): string => `row_${Date.now().toString(36)}_${(counter += 1).toString(36)}`;

/**
 * Returns null rather than throwing when consent is absent.
 *
 * A pipeline processing thousands of completed reviews should skip the ones it
 * may not use, not stop. Throwing would push callers toward a try/catch that
 * swallows genuine errors alongside the routine ones.
 */
export function extract(input: ExtractInput): DatasetRow | null {
  if (!isExtractable(input)) return null;

  const { submission, review, reviewer } = input;
  const body = deidentify(submission.content);
  const correction = review.comments ? deidentify(review.comments) : null;
  const hallucination = review.hallucinationDetails ? deidentify(review.hallucinationDetails) : null;
  const missing = review.missingInformationDetails
    ? deidentify(review.missingInformationDetails)
    : null;

  const redactions = [
    ...new Set([
      ...body.redactions,
      ...(correction?.redactions ?? []),
      ...(hallucination?.redactions ?? []),
      ...(missing?.redactions ?? []),
    ]),
  ];

  return {
    id: (input.rowId ?? defaultRowId)(),
    input: body.text,
    aiSystem: submission.aiSystem ?? null,
    specialty: submission.specialty,
    complexity: submission.complexity ?? null,
    riskLevel: submission.riskLevel ?? null,
    accuracy: review.accuracy ?? null,
    hallucinationDetected: review.hallucinationDetected ?? null,
    hallucinationDetails: hallucination?.text ?? null,
    missingInformation: review.missingInformation ?? null,
    missingInformationDetails: missing?.text ?? null,
    safetyLevel: review.safetyLevel ?? null,
    clinicalReasoning: review.clinicalReasoning ?? null,
    verdict: review.verdict ?? null,
    correction: correction?.text ?? null,
    reviewerSpecialty: reviewer?.specialty ?? null,
    reviewerYearsExperience: reviewer?.yearsExperience ?? null,
    reviewedAt: review.submittedAt ?? null,
    redactions,
  };
}

/* --- Packaging ------------------------------------------------------------- */

export interface DatasetPack {
  specialty: string;
  rows: DatasetRow[];
  /** Counts a buyer needs before committing, computed rather than asserted. */
  summary: {
    total: number;
    withCorrections: number;
    withHallucinations: number;
    byVerdict: Record<string, number>;
    byRisk: Record<string, number>;
  };
}

/** Groups extracted rows into per-specialty packs with an honest summary. */
export function pack(rows: DatasetRow[]): DatasetPack[] {
  const bySpecialty = new Map<string, DatasetRow[]>();
  for (const row of rows) {
    const list = bySpecialty.get(row.specialty) ?? [];
    list.push(row);
    bySpecialty.set(row.specialty, list);
  }

  return [...bySpecialty.entries()].map(([specialty, group]) => ({
    specialty,
    rows: group,
    summary: {
      total: group.length,
      withCorrections: group.filter((r) => r.correction && r.correction.trim().length > 0).length,
      withHallucinations: group.filter((r) => r.hallucinationDetected === true).length,
      byVerdict: tally(group.map((r) => r.verdict)),
      byRisk: tally(group.map((r) => r.riskLevel)),
    },
  }));
}

function tally(values: Array<string | null>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = value ?? "unclassified";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** JSONL — one row per line, the format evaluation harnesses actually consume. */
export const toJsonl = (rows: DatasetRow[]): string =>
  rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
