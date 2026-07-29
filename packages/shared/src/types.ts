/**
 * Domain types for the Harmony Verify platform.
 *
 * Field names and enum values follow the Phase 2 architecture spec exactly, so the
 * database columns, API payloads and UI all speak one vocabulary.
 */

export type Id = string;
export type IsoDateTime = string;

/* --- Users -------------------------------------------------------------- */

export const USER_ROLES = ["customer", "expert", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface User {
  id: Id;
  name: string;
  email: string;
  role: UserRole;
  organisation?: string;
  createdAt: IsoDateTime;
}

/** Never leaves the database layer. */
export interface UserCredentials {
  userId: Id;
  passwordHash: string;
  passwordSalt: string;
}

/* --- Clinical taxonomy -------------------------------------------------- */

export const SPECIALTIES = [
  "cardiology",
  "oncology",
  "neurology",
  "radiology",
  "general-medicine",
  "other",
] as const;
export type Specialty = (typeof SPECIALTIES)[number];

export const SPECIALTY_LABELS: Record<Specialty, string> = {
  cardiology: "Cardiology",
  oncology: "Oncology",
  neurology: "Neurology",
  radiology: "Radiology",
  "general-medicine": "General Medicine",
  other: "Other",
};

export const REVIEW_TYPES = [
  "single-verification",
  "deep-clinical-review",
  "continuous-monitoring",
] as const;
export type ReviewType = (typeof REVIEW_TYPES)[number];

export const REVIEW_TYPE_LABELS: Record<ReviewType, string> = {
  "single-verification": "Single verification",
  "deep-clinical-review": "Deep clinical review",
  "continuous-monitoring": "Continuous monitoring",
};

export const PRIORITIES = ["standard", "urgent", "critical"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const LEVELS = ["low", "medium", "high"] as const;
export type Complexity = (typeof LEVELS)[number];
export type RiskLevel = (typeof LEVELS)[number];

/* --- Experts ------------------------------------------------------------ */

export const EXPERT_STATUSES = ["pending", "active", "suspended"] as const;
export type ExpertStatus = (typeof EXPERT_STATUSES)[number];

export const AVAILABILITY = ["available", "busy", "unavailable"] as const;
export type Availability = (typeof AVAILABILITY)[number];

export interface Expert {
  id: Id;
  userId: Id;
  name: string;
  specialty: Specialty;
  subSpecialty?: string;
  credentials: string;
  yearsExperience: number;
  availability: Availability;
  rating: number;
  ratingCount: number;
  status: ExpertStatus;
  /** Vendors or organisations this expert must never review for. */
  conflictsOfInterest: string[];
  activeCaseCount: number;
  maxConcurrentCases: number;
  createdAt: IsoDateTime;
}

/* --- Submissions -------------------------------------------------------- */

export const SUBMISSION_STATUSES = [
  "submitted",
  "analyzing",
  "expert-assigned",
  "under-review",
  "completed",
  "cancelled",
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  submitted: "Submitted",
  analyzing: "Analyzing",
  "expert-assigned": "Expert Assigned",
  "under-review": "Under Review",
  completed: "Completed",
  cancelled: "Cancelled",
};

export interface Submission {
  id: Id;
  customerId: Id;
  title: string;
  /** Name of the AI system that produced the output, e.g. "CardioAssist v3". */
  aiSystem: string;
  content: string;
  fileUrl?: string;
  specialty: Specialty;
  reviewType: ReviewType;
  priority: Priority;
  complexity?: Complexity;
  riskLevel?: RiskLevel;
  status: SubmissionStatus;
  assignedExpertId?: Id;
  /** Cents. Integer arithmetic only — never floats for money. */
  priceCents?: number;
  /** Promised delivery time. */
  eta?: IsoDateTime;
  reportUrl?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/* --- Reviews ------------------------------------------------------------ */

export const ACCURACY = ["accurate", "minor-issues", "incorrect"] as const;
export type Accuracy = (typeof ACCURACY)[number];

export const SAFETY_LEVELS = ["safe", "needs-revision", "unsafe"] as const;
export type SafetyLevel = (typeof SAFETY_LEVELS)[number];

export const REASONING_QUALITY = ["strong", "questionable", "poor"] as const;
export type ClinicalReasoning = (typeof REASONING_QUALITY)[number];

export const VERDICTS = ["verified", "needs-revision", "unsafe"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const REVIEW_STATUSES = ["assigned", "accepted", "rejected", "submitted"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export interface Review {
  id: Id;
  submissionId: Id;
  expertId: Id;
  status: ReviewStatus;
  accuracy?: Accuracy;
  hallucinationDetected?: boolean;
  hallucinationDetails?: string;
  missingInformation?: boolean;
  missingInformationDetails?: string;
  safetyLevel?: SafetyLevel;
  clinicalReasoning?: ClinicalReasoning;
  verdict?: Verdict;
  comments?: string;
  assignedAt: IsoDateTime;
  acceptedAt?: IsoDateTime;
  submittedAt?: IsoDateTime;
}

/* --- Reports ------------------------------------------------------------ */

export interface Report {
  id: Id;
  submissionId: Id;
  /** 0–100 reliability score derived from the review. */
  verificationScore: number;
  summary: string;
  pdfUrl?: string;
  createdAt: IsoDateTime;
}

/* --- Payments ----------------------------------------------------------- */

export const PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface Payment {
  id: Id;
  submissionId: Id;
  amountCents: number;
  currency: "USD";
  status: PaymentStatus;
  provider: string;
  reference?: string;
  createdAt: IsoDateTime;
}

/* --- Engine outputs ----------------------------------------------------- */

/** What processVerificationRequest() returns. */
export interface VerificationAnalysis {
  specialty: Specialty;
  complexity: Complexity;
  risk: RiskLevel;
  recommendedExpert: {
    specialty: Specialty;
    minYearsExperience: number;
    minRating: number;
  };
  /** Turnaround in hours. */
  estimatedTimeHours: number;
  estimatedPrice: { minCents: number; maxCents: number };
  /** Human-readable reasons, surfaced in the UI and the audit trail. */
  rationale: string[];
}

export interface PriceQuote {
  baseCents: number;
  complexityCents: number;
  priorityCents: number;
  reviewTypeCents: number;
  totalCents: number;
  currency: "USD";
  slaHours: number;
  breakdown: string[];
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

/* --- Sessions ----------------------------------------------------------- */

export interface Session {
  token: string;
  userId: Id;
  role: UserRole;
  expiresAt: IsoDateTime;
}
