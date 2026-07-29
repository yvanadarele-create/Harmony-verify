import type {
  Accuracy,
  Priority,
  RiskLevel,
  SafetyLevel,
  SubmissionStatus,
  Verdict,
} from "@harmony/shared";

/**
 * Framework-agnostic presentation helpers.
 *
 * Deliberately free of React so the marketing site, the portals and server-rendered
 * emails all derive a status colour the same way. A verdict must never look
 * "verified" in one surface and "pending" in another.
 */

export type Tone = "pending" | "verified" | "flagged" | "neutral";

/** Maps a tone to the CSS class the design system defines. */
export const chipClass = (tone: Tone): string =>
  tone === "neutral" ? "chip" : `chip chip--${tone === "pending" ? "review" : tone}`;

export interface Badge {
  label: string;
  tone: Tone;
}

const SUBMISSION_BADGES: Record<SubmissionStatus, Badge> = {
  submitted: { label: "Submitted", tone: "neutral" },
  analyzing: { label: "Analyzing", tone: "pending" },
  "expert-assigned": { label: "Expert Assigned", tone: "pending" },
  "under-review": { label: "Under Review", tone: "pending" },
  completed: { label: "Completed", tone: "verified" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const submissionBadge = (s: SubmissionStatus): Badge => SUBMISSION_BADGES[s];

const VERDICT_BADGES: Record<Verdict, Badge> = {
  verified: { label: "Verified", tone: "verified" },
  "needs-revision": { label: "Needs Revision", tone: "pending" },
  unsafe: { label: "Unsafe", tone: "flagged" },
};

export const verdictBadge = (v: Verdict): Badge => VERDICT_BADGES[v];

const RISK_BADGES: Record<RiskLevel, Badge> = {
  low: { label: "Low risk", tone: "verified" },
  medium: { label: "Medium risk", tone: "pending" },
  high: { label: "High risk", tone: "flagged" },
};

export const riskBadge = (r: RiskLevel): Badge => RISK_BADGES[r];

const ACCURACY_BADGES: Record<Accuracy, Badge> = {
  accurate: { label: "Accurate", tone: "verified" },
  "minor-issues": { label: "Minor issues", tone: "pending" },
  incorrect: { label: "Incorrect", tone: "flagged" },
};

export const accuracyBadge = (a: Accuracy): Badge => ACCURACY_BADGES[a];

const SAFETY_BADGES: Record<SafetyLevel, Badge> = {
  safe: { label: "Safe", tone: "verified" },
  "needs-revision": { label: "Needs revision", tone: "pending" },
  unsafe: { label: "Unsafe", tone: "flagged" },
};

export const safetyBadge = (s: SafetyLevel): Badge => SAFETY_BADGES[s];

export const priorityLabel = (p: Priority): string =>
  ({ standard: "Standard", urgent: "Urgent", critical: "Critical" })[p];

/** The five statuses a customer sees on the tracking page, in order. */
export const TRACKING_STEPS: readonly SubmissionStatus[] = [
  "submitted",
  "analyzing",
  "expert-assigned",
  "under-review",
  "completed",
] as const;

/** How far through tracking a submission is, 0–1. Cancelled reports as 0. */
export function trackingProgress(status: SubmissionStatus): number {
  const i = TRACKING_STEPS.indexOf(status);
  if (i < 0) return 0;
  return (i + 1) / TRACKING_STEPS.length;
}

/* --- Formatting --------------------------------------------------------- */

export const formatMoney = (cents: number, currency = "USD"): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);

/** Turnaround expressed the way a person would say it. */
export function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = Math.floor(hours / 24);
  const rest = Math.round(hours % 24);
  return rest ? `${days}d ${rest}h` : `${days}d`;
}

/** Relative time for lists. Past instants read "ago", future ones "in". */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMs = then - now.getTime();
  const past = diffMs < 0;
  const mins = Math.round(Math.abs(diffMs) / 60_000);

  const say = (n: number, unit: string): string => {
    const plural = n === 1 ? unit : `${unit}s`;
    return past ? `${n} ${plural} ago` : `in ${n} ${plural}`;
  };

  if (mins < 1) return "just now";
  if (mins < 60) return say(mins, "minute");
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return say(hrs, "hour");
  return say(Math.round(hrs / 24), "day");
}

/** Joins conditional class names. */
export const cx = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(" ");

/** Escapes text destined for an HTML template. */
export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
