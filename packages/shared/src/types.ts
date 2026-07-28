/**
 * Domain types shared across every Harmony Verify app and package.
 *
 * These mirror the persisted schema in @harmony/database. Keeping them here — rather
 * than in the database package — lets the browser apps import types without pulling in
 * a database driver.
 */

export type Id = string;
export type IsoDateTime = string;

/* --- People ------------------------------------------------------------- */

export type UserRole = "customer" | "expert" | "admin";

export interface User {
  id: Id;
  email: string;
  fullName: string;
  role: UserRole;
  organisation?: string;
  createdAt: IsoDateTime;
}

/* --- Clinical taxonomy -------------------------------------------------- */

export const SPECIALTIES = [
  "cardiology",
  "oncology",
  "emergency-medicine",
  "primary-care",
  "nephrology",
  "neurology",
  "psychiatry",
  "paediatrics",
  "obstetrics-gynaecology",
  "pharmacology",
  "radiology",
  "surgery",
] as const;

export type Specialty = (typeof SPECIALTIES)[number];

/** The product surface an output came from. Drives which rubric weighting applies. */
export const TASK_TYPES = [
  "clinical-decision-support",
  "documentation",
  "coding",
  "patient-facing",
  "utilisation-review",
] as const;

export type TaskType = (typeof TASK_TYPES)[number];

export type RiskLevel = "low" | "medium" | "high";
export type Urgency = "standard" | "priority" | "urgent";

/** Single reviewer, or two independent reviewers with adjudication on disagreement. */
export type ReviewMode = "single" | "double";

/* --- Experts ------------------------------------------------------------ */

export type ExpertStatus = "pending" | "active" | "suspended" | "removed";
export type AvailabilityTier = "standard" | "extended" | "on-call";

export interface Expert {
  id: Id;
  userId: Id;
  fullName: string;
  specialty: Specialty;
  subSpecialties: Specialty[];
  status: ExpertStatus;
  licenceNumber: string;
  licenceJurisdiction: string;
  licenceVerifiedAt?: IsoDateTime;
  boardCertified: boolean;
  yearsExperience: number;
  availabilityTier: AvailabilityTier;
  /** Cents per review, before urgency multipliers. */
  payRateCents: number;
  rating: number;
  ratingCount: number;
  /** Employers/vendors this expert must never be routed cases from. */
  conflictsOfInterest: string[];
  activeCaseCount: number;
  maxConcurrentCases: number;
  createdAt: IsoDateTime;
}

/* --- Submissions -------------------------------------------------------- */

export type SubmissionStatus =
  | "draft"
  | "awaiting-payment"
  | "queued"
  | "assigned"
  | "in-review"
  | "adjudicating"
  | "completed"
  | "cancelled";

export type PaymentStatus = "unpaid" | "paid" | "refunded" | "failed";

export interface Submission {
  id: Id;
  customerId: Id;
  title: string;
  /** The AI-generated output under review. */
  outputText: string;
  /** The clinical context the output was generated from. */
  contextText?: string;
  fileUrl?: string;
  specialty: Specialty;
  taskType: TaskType;
  urgency: Urgency;
  reviewMode: ReviewMode;
  status: SubmissionStatus;
  paymentStatus: PaymentStatus;
  riskLevel?: RiskLevel;
  complexityScore?: number;
  priceCents?: number;
  slaHours?: number;
  assignedExpertIds: Id[];
  reportUrl?: string;
  createdAt: IsoDateTime;
  dueAt?: IsoDateTime;
  completedAt?: IsoDateTime;
}

/* --- Reviews ------------------------------------------------------------ */

/** The six rubric dimensions every review is scored against. */
export const RUBRIC_DIMENSIONS = [
  "factualAccuracy",
  "guidelineConcordance",
  "safety",
  "completeness",
  "calibration",
  "scope",
] as const;

export type RubricDimension = (typeof RUBRIC_DIMENSIONS)[number];

/** 1 = unacceptable, 5 = no issues found. */
export type RubricScore = 1 | 2 | 3 | 4 | 5;

export type FailureCategory =
  | "unsupported-claim"
  | "guideline-drift"
  | "interaction-missed"
  | "overconfidence"
  | "omission"
  | "unsafe-dose"
  | "scope-creep"
  | "missed-red-flag";

export type Severity = "minor" | "moderate" | "severe" | "critical";

export interface Correction {
  id: Id;
  category: FailureCategory;
  severity: Severity;
  /** Character offsets into Submission.outputText. */
  spanStart?: number;
  spanEnd?: number;
  quotedText?: string;
  explanation: string;
  suggestedReplacement?: string;
}

export type EvidenceKind = "guideline" | "drug-label" | "literature" | "policy";

export interface Evidence {
  id: Id;
  kind: EvidenceKind;
  citation: string;
  url?: string;
  /** Which correction or dimension this evidence supports. */
  supports?: string;
}

export type Verdict =
  | "verified"
  | "verified-with-amendment"
  | "corrected"
  | "rejected";

export type ReviewStatus = "assigned" | "accepted" | "submitted" | "expired" | "declined";

export interface Review {
  id: Id;
  submissionId: Id;
  expertId: Id;
  status: ReviewStatus;
  scores: Partial<Record<RubricDimension, RubricScore>>;
  verdict?: Verdict;
  riskLevel?: RiskLevel;
  corrections: Correction[];
  evidence: Evidence[];
  comments?: string;
  /** Reviewer's own confidence, used to trigger escalation. */
  confidence?: number;
  assignedAt: IsoDateTime;
  acceptedAt?: IsoDateTime;
  submittedAt?: IsoDateTime;
}

/* --- Verification record (the deliverable) ------------------------------ */

export interface ReviewerAttribution {
  expertId: Id;
  fullName: string;
  specialty: Specialty;
  boardCertified: boolean;
  licenceJurisdiction: string;
}

export interface VerificationRecord {
  id: Id;
  submissionId: Id;
  verdict: Verdict;
  riskLevel: RiskLevel;
  scores: Record<RubricDimension, RubricScore>;
  corrections: Correction[];
  evidence: Evidence[];
  reviewers: ReviewerAttribution[];
  /** Set when two reviewers disagreed and the case was adjudicated. */
  adjudicated: boolean;
  disagreements?: string[];
  receivedAt: IsoDateTime;
  completedAt: IsoDateTime;
  turnaroundMinutes: number;
  /** Hash over the record body, so tampering is detectable. */
  signature: string;
}

/* --- Money -------------------------------------------------------------- */

export interface PriceBreakdown {
  baseCents: number;
  complexityCents: number;
  urgencyCents: number;
  reviewModeCents: number;
  totalCents: number;
  currency: "USD";
  slaHours: number;
  explanation: string[];
}

export interface Wallet {
  id: Id;
  expertId: Id;
  balanceCents: number;
  totalEarnedCents: number;
  pendingPayoutCents: number;
  totalWithdrawnCents: number;
}

export type PaymentType = "charge" | "payout" | "refund";

export interface Payment {
  id: Id;
  type: PaymentType;
  amountCents: number;
  currency: "USD";
  payerId?: Id;
  payeeId?: Id;
  relatedId?: Id;
  status: "pending" | "succeeded" | "failed";
  reference?: string;
  createdAt: IsoDateTime;
}

/* --- Audit -------------------------------------------------------------- */

export interface AuditEntry {
  id: Id;
  actorId: Id;
  actorRole: UserRole;
  action: string;
  targetType: string;
  targetId: Id;
  metadata?: Record<string, unknown>;
  at: IsoDateTime;
}
