import type { Expert, Review, Submission, Specialty } from "@harmony/shared";
import { categoriseReview, type FailureCategory } from "@harmony/cognitive-data";

/**
 * Aggregate quality metrics.
 *
 * Pure functions over arrays so the same code serves the customer dashboard, the admin
 * console and a scheduled report, and so every metric is testable without a database.
 */

export interface CustomerMetrics {
  total: number;
  inFlight: number;
  completed: number;
  /** Share of completed reviews with no findings, 0–1. Null when nothing is completed. */
  cleanRate: number | null;
  averageScore: number | null;
  spendCents: number;
  byFailure: Array<{ category: FailureCategory; count: number }>;
}

export function customerMetrics(
  submissions: readonly Submission[],
  reviews: readonly Review[],
  scores: ReadonlyMap<string, number>,
): CustomerMetrics {
  const completed = submissions.filter((s) => s.status === "completed");
  const inFlight = submissions.filter(
    (s) => s.status !== "completed" && s.status !== "cancelled",
  );

  const submitted = reviews.filter((r) => r.status === "submitted");
  const clean = submitted.filter(
    (r) => r.verdict === "verified" && !r.hallucinationDetected && !r.missingInformation,
  );

  const scoreValues = completed
    .map((s) => scores.get(s.id))
    .filter((v): v is number => typeof v === "number");

  const counts = new Map<FailureCategory, number>();
  for (const r of submitted) {
    for (const c of categoriseReview(r)) counts.set(c, (counts.get(c) ?? 0) + 1);
  }

  return {
    total: submissions.length,
    inFlight: inFlight.length,
    completed: completed.length,
    cleanRate: submitted.length ? clean.length / submitted.length : null,
    averageScore: scoreValues.length ? mean(scoreValues) : null,
    spendCents: submissions.reduce((sum, s) => sum + (s.priceCents ?? 0), 0),
    byFailure: [...counts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export interface SpecialtyBreakdown {
  specialty: Specialty;
  submissions: number;
  completed: number;
  averageScore: number | null;
  failureRate: number | null;
}

/** Where a customer's model is weakest — the signal worth paying for. */
export function bySpecialty(
  submissions: readonly Submission[],
  reviews: readonly Review[],
  scores: ReadonlyMap<string, number>,
): SpecialtyBreakdown[] {
  const byId = new Map(reviews.map((r) => [r.submissionId, r]));
  const groups = new Map<Specialty, Submission[]>();
  for (const s of submissions) {
    const list = groups.get(s.specialty) ?? [];
    list.push(s);
    groups.set(s.specialty, list);
  }

  return [...groups.entries()]
    .map(([specialty, list]) => {
      const done = list.filter((s) => s.status === "completed");
      const scoreValues = done
        .map((s) => scores.get(s.id))
        .filter((v): v is number => typeof v === "number");
      const judged = list
        .map((s) => byId.get(s.id))
        .filter((r): r is Review => r?.status === "submitted");
      const failed = judged.filter((r) => r.verdict !== "verified");
      return {
        specialty,
        submissions: list.length,
        completed: done.length,
        averageScore: scoreValues.length ? mean(scoreValues) : null,
        failureRate: judged.length ? failed.length / judged.length : null,
      };
    })
    .sort((a, b) => b.submissions - a.submissions);
}

export interface PlatformMetrics {
  totalSubmissions: number;
  activeExperts: number;
  completedReviews: number;
  revenueCents: number;
  /** Median hours from submission to completion. Null when nothing is completed. */
  medianTurnaroundHours: number | null;
  /** Cases queued with no expert assigned — the operational alarm. */
  unassigned: number;
}

export function platformMetrics(
  submissions: readonly Submission[],
  experts: readonly Expert[],
  reviews: readonly Review[],
  revenueCents: number,
): PlatformMetrics {
  const completed = submissions.filter((s) => s.status === "completed");

  const turnarounds = completed
    .map((s) => {
      const done = reviews.find((r) => r.submissionId === s.id)?.submittedAt;
      if (!done) return null;
      const ms = new Date(done).getTime() - new Date(s.createdAt).getTime();
      return ms > 0 ? ms / 3_600_000 : null;
    })
    .filter((v): v is number => v !== null);

  return {
    totalSubmissions: submissions.length,
    activeExperts: experts.filter((e) => e.status === "active").length,
    completedReviews: reviews.filter((r) => r.status === "submitted").length,
    revenueCents,
    medianTurnaroundHours: turnarounds.length ? median(turnarounds) : null,
    unassigned: submissions.filter(
      (s) => !s.assignedExpertId && s.status !== "completed" && s.status !== "cancelled",
    ).length,
  };
}

export interface ExpertMetrics {
  expertId: string;
  assigned: number;
  completed: number;
  /** Share of assigned cases actually delivered, 0–1. */
  completionRate: number | null;
  rating: number;
  ratingCount: number;
}

export function expertMetrics(expert: Expert, reviews: readonly Review[]): ExpertMetrics {
  const mine = reviews.filter((r) => r.expertId === expert.id);
  const done = mine.filter((r) => r.status === "submitted");
  return {
    expertId: expert.id,
    assigned: mine.length,
    completed: done.length,
    completionRate: mine.length ? done.length / mine.length : null,
    rating: expert.rating,
    ratingCount: expert.ratingCount,
  };
}

/* --- Statistics --------------------------------------------------------- */

export const mean = (xs: readonly number[]): number =>
  xs.reduce((a, b) => a + b, 0) / xs.length;

/** Median. Averages the middle pair on even-length input. */
export function median(xs: readonly number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export const asPercent = (ratio: number | null, dp = 0): string =>
  ratio === null ? "—" : `${(ratio * 100).toFixed(dp)}%`;
