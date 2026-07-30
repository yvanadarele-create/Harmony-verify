import type { Review, Submission } from "@harmony/shared";

/**
 * The customer's deliverable, as structure rather than formatting.
 *
 * One model, rendered to PDF and to Word from the same source, so the two can
 * never disagree — a governance committee comparing the PDF a vendor sent with
 * the Word file they pasted into their own template must find the same words.
 *
 * The document opens by thanking the customer and closes with the reviewer's
 * name and credentials. Both are deliberate: the first because someone chose to
 * have their work checked and that is worth acknowledging, the second because a
 * verification nobody signs is an opinion, not a record.
 */

export interface ReportReviewer {
  name: string;
  credentials: string;
  specialty: string;
  licenseNumber?: string | null;
  institution?: string | null;
  yearsExperience?: number | null;
}

export interface ReportInput {
  submission: Submission;
  review: Review;
  reviewer: ReportReviewer;
  /** From @harmony/verification-engine's scoreReport. */
  score: number;
  deductions: Array<{ reason: string; points: number }>;
  customerName?: string | null;
  organisation?: string | null;
  /** Injected in tests. */
  now?: Date;
}

export interface ReportBlock {
  heading: string;
  /** Paragraphs. */
  body?: string[];
  /** Label/value rows, rendered as a two-column table. */
  rows?: Array<[string, string]>;
  /** Bulleted items. */
  bullets?: string[];
}

export interface VerificationReport {
  reference: string;
  title: string;
  subtitle: string;
  issuedAt: string;
  verdict: string;
  score: number;
  blocks: ReportBlock[];
  /** Rendered at the foot of every page. */
  footer: string;
}

const VERDICT_LABEL: Record<string, string> = {
  verified: "Verified",
  "needs-revision": "Needs revision",
  unsafe: "Unsafe — do not deploy",
};

const ACCURACY_LABEL: Record<string, string> = {
  accurate: "Accurate",
  "minor-issues": "Minor issues",
  incorrect: "Incorrect",
};

const SAFETY_LABEL: Record<string, string> = {
  safe: "Safe",
  "needs-revision": "Needs revision",
  unsafe: "Unsafe",
};

const REASONING_LABEL: Record<string, string> = {
  strong: "Strong",
  questionable: "Questionable",
  poor: "Poor",
};

const title = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

export function buildReport(input: ReportInput): VerificationReport {
  const { submission, review, reviewer } = input;
  const issuedAt = (input.now ?? new Date()).toISOString().slice(0, 10);
  const reference = `HV-${issuedAt.replace(/-/g, "").slice(0, 8)}-${submission.id.slice(-6).toUpperCase()}`;
  const verdict = VERDICT_LABEL[review.verdict ?? ""] ?? "Assessment complete";

  const blocks: ReportBlock[] = [];

  /* 1. Acknowledgement — the first thing the reader sees. */
  blocks.push({
    heading: "Thank you for trusting Harmony Verify",
    body: [
      `Thank you for trusting Harmony Verify with the reliability of your AI outputs${
        input.organisation ? `, ${input.organisation}` : ""
      }.`,
      "This document records an independent clinical assessment of the output submitted under the reference above. It was performed by a licensed clinician practising in the relevant specialty, who has no involvement in building or selling the system being assessed.",
      "It is written to be read by a clinical governance committee without translation. Every judgement below is attributable to the named reviewer at the end of this document.",
    ],
  });

  /* 2. Summary. */
  blocks.push({
    heading: "Summary",
    rows: [
      ["Reference", reference],
      ["Issued", issuedAt],
      ["Submission", submission.title],
      ["AI system", submission.aiSystem || "Not stated"],
      ["Specialty", title(submission.specialty.replace(/-/g, " "))],
      ["Case complexity", submission.complexity ? title(submission.complexity) : "Not classified"],
      ["Clinical risk", submission.riskLevel ? title(submission.riskLevel) : "Not classified"],
      ["Verdict", verdict],
      ["Reliability score", `${input.score} / 100`],
    ],
  });

  /* 3. The output as submitted — unedited, so the assessment is anchored. */
  blocks.push({
    heading: "The output as submitted",
    body: [submission.content],
  });

  /* 4. The rubric, dimension by dimension. */
  blocks.push({
    heading: "Assessment",
    rows: [
      ["Medical accuracy", ACCURACY_LABEL[review.accuracy ?? ""] ?? "Not assessed"],
      ["Hallucination detected", review.hallucinationDetected ? "Yes" : "No"],
      ["Missing information", review.missingInformation ? "Yes" : "No"],
      ["Safety", SAFETY_LABEL[review.safetyLevel ?? ""] ?? "Not assessed"],
      ["Clinical reasoning", REASONING_LABEL[review.clinicalReasoning ?? ""] ?? "Not assessed"],
    ],
  });

  if (review.hallucinationDetected && review.hallucinationDetails) {
    blocks.push({ heading: "Fabricated or unsupported content", body: [review.hallucinationDetails] });
  }

  if (review.missingInformation && review.missingInformationDetails) {
    blocks.push({ heading: "Material information omitted", body: [review.missingInformationDetails] });
  }

  /* 5. The corrections — what most customers are actually buying. */
  if (review.comments) {
    blocks.push({
      heading: "Reviewer assessment and corrections",
      body: [review.comments],
    });
  }

  /* 6. How the score was reached. An unexplained score is a number, not evidence. */
  blocks.push({
    heading: "How this score was reached",
    body: [
      "The score starts at 100 and each finding deducts a fixed, published number of points. It is a deduction model rather than a weighting, so a disputed score can be reconstructed line by line.",
    ],
    rows: [
      ...(input.deductions.length > 0
        ? input.deductions.map((d): [string, string] => [d.reason, `−${d.points}`])
        : ([["No deductions applied", "—"]] as Array<[string, string]>)),
      ["Final score", `${input.score} / 100`],
    ],
  });

  /* 7. Signature. */
  blocks.push({
    heading: "Reviewer",
    rows: [
      ["Name", reviewer.name],
      ["Credentials", reviewer.credentials],
      ["Specialty", title(reviewer.specialty.replace(/-/g, " "))],
      ["Licence number", reviewer.licenseNumber || "Held on file"],
      ["Institution", reviewer.institution || "Held on file"],
      ...(reviewer.yearsExperience
        ? ([["Years in practice", String(reviewer.yearsExperience)]] as Array<[string, string]>)
        : []),
      ["Reviewed", review.submittedAt ? review.submittedAt.slice(0, 10) : issuedAt],
    ],
    body: [
      "This assessment is the professional judgement of the named reviewer. Harmony Verify does not practise medicine and does not provide medical advice. Expert review substantially reduces the risk of an incorrect output reaching a clinician; it does not reduce that risk to zero, and clinical responsibility remains with the treating clinician and with the organisation deploying the system.",
    ],
  });

  return {
    reference,
    title: "Clinical verification report",
    subtitle: submission.title,
    issuedAt,
    verdict,
    score: input.score,
    blocks,
    footer: `Harmony Verify · ${reference} · Confidential`,
  };
}

/* --- Plain text ----------------------------------------------------------- */

/** Used in the notification email's fallback and in tests. */
export function toText(report: VerificationReport): string {
  const lines: string[] = [
    report.title.toUpperCase(),
    report.subtitle,
    `Reference ${report.reference} · Issued ${report.issuedAt}`,
    "",
  ];

  for (const block of report.blocks) {
    lines.push(block.heading.toUpperCase(), "");
    for (const paragraph of block.body ?? []) lines.push(paragraph, "");
    for (const [label, value] of block.rows ?? []) lines.push(`  ${label}: ${value}`);
    for (const bullet of block.bullets ?? []) lines.push(`  - ${bullet}`);
    if (block.rows || block.bullets) lines.push("");
  }

  lines.push(report.footer);
  return lines.join("\n");
}
