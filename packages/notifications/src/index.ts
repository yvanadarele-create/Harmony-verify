import type { Expert, Submission, User, Verdict } from "@harmony/shared";
import { escapeHtml, formatDuration, formatMoney } from "@harmony/ui";

/**
 * Notification composition and delivery.
 *
 * Composition is pure and separate from transport, so message content is testable
 * without sending anything, and swapping the provider never risks changing what a
 * customer reads.
 */

export type Channel = "email" | "in-app";

export interface Message {
  to: string;
  subject: string;
  /** Plain text is authored first — it is what actually gets read on a phone. */
  text: string;
  html: string;
  channel: Channel;
}

export interface Transport {
  send(message: Message): Promise<{ id: string }>;
}

/**
 * Captures messages instead of sending them. Used in tests and in local development,
 * where a real transport would either fail or, worse, email a real clinician.
 */
export class MemoryTransport implements Transport {
  readonly sent: Message[] = [];

  async send(message: Message): Promise<{ id: string }> {
    this.sent.push(message);
    return { id: `mem_${this.sent.length}` };
  }

  clear(): void {
    this.sent.length = 0;
  }
}

/* --- Templates ---------------------------------------------------------- */

const BRAND = "Harmony Verify";

function layout(heading: string, body: string, cta?: { label: string; url: string }): string {
  return [
    `<div style="background:#050F24;padding:32px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#E8EDF5">`,
    `<div style="max-width:560px;margin:0 auto;border:1px solid rgba(212,175,55,0.18);border-radius:6px;padding:28px;background:#071A3D">`,
    `<p style="margin:0 0 20px;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#D4AF37">${escapeHtml(BRAND)}</p>`,
    `<h1 style="margin:0 0 16px;font-size:22px;font-weight:400;color:#fff">${escapeHtml(heading)}</h1>`,
    `<div style="font-size:15px;line-height:1.65;color:rgba(200,215,240,0.85)">${body}</div>`,
    cta
      ? `<p style="margin:26px 0 0"><a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:12px 24px;background:#D4AF37;color:#1b1405;text-decoration:none;border-radius:3px;font-weight:600;font-size:13px;letter-spacing:.08em;text-transform:uppercase">${escapeHtml(cta.label)}</a></p>`
      : "",
    `<p style="margin:26px 0 0;font-size:12px;color:rgba(200,215,240,0.55)">${escapeHtml(BRAND)} does not practise medicine and does not provide medical advice.</p>`,
    `</div></div>`,
  ].join("");
}

const p = (s: string): string => `<p style="margin:0 0 12px">${escapeHtml(s)}</p>`;

export function submissionReceived(user: User, submission: Submission, url: string): Message {
  const heading = "Verification request received";
  const lines = [
    `Hello ${user.name},`,
    `We have received "${submission.title}" for verification and are analysing it now.`,
    submission.priceCents ? `Price: ${formatMoney(submission.priceCents)}` : "",
    submission.eta ? `Expected by: ${new Date(submission.eta).toUTCString()}` : "",
    `Reference: ${submission.id}`,
  ].filter(Boolean);

  return {
    to: user.email,
    channel: "email",
    subject: `${BRAND} — request received (${submission.id})`,
    text: `${lines.join("\n\n")}\n\nTrack it: ${url}`,
    html: layout(heading, lines.map(p).join(""), { label: "Track request", url }),
  };
}

export function expertAssigned(user: User, submission: Submission, expert: Expert, url: string): Message {
  const lines = [
    `Hello ${user.name},`,
    `"${submission.title}" has been assigned to a ${expert.specialty.replace("-", " ")} reviewer.`,
    `Reviewer: ${expert.name}, ${expert.credentials}`,
    submission.eta ? `Expected by: ${new Date(submission.eta).toUTCString()}` : "",
  ].filter(Boolean);

  return {
    to: user.email,
    channel: "email",
    subject: `${BRAND} — reviewer assigned (${submission.id})`,
    text: `${lines.join("\n\n")}\n\nTrack it: ${url}`,
    html: layout("A reviewer has been assigned", lines.map(p).join(""), {
      label: "Track request",
      url,
    }),
  };
}

const VERDICT_TEXT: Record<Verdict, string> = {
  verified: "Verified — no material issues were identified.",
  "needs-revision": "Needs revision — the reviewer identified issues to correct.",
  unsafe: "Unsafe — do not rely on this output as written.",
};

export function reportReady(
  user: User,
  submission: Submission,
  verdict: Verdict,
  score: number,
  url: string,
): Message {
  const lines = [
    `Hello ${user.name},`,
    `The verification report for "${submission.title}" is ready.`,
    VERDICT_TEXT[verdict],
    `Reliability score: ${score}/100`,
  ];

  return {
    to: user.email,
    channel: "email",
    // The verdict belongs in the subject — an "unsafe" result should not need a click.
    subject: `${BRAND} — ${verdict === "verified" ? "verified" : verdict.replace("-", " ")} (${submission.id})`,
    text: `${lines.join("\n\n")}\n\nRead the report: ${url}`,
    html: layout("Your verification report is ready", lines.map(p).join(""), {
      label: "View report",
      url,
    }),
  };
}

export function reviewAssignedToExpert(
  expertUser: User,
  submission: Submission,
  slaHours: number,
  url: string,
): Message {
  const lines = [
    `Hello ${expertUser.name},`,
    `A ${submission.specialty.replace("-", " ")} case has been routed to you.`,
    `Priority: ${submission.priority}. Turnaround: ${formatDuration(slaHours)}.`,
    `Reference: ${submission.id}`,
  ];

  return {
    to: expertUser.email,
    channel: "email",
    subject: `${BRAND} — new case (${submission.priority})`,
    text: `${lines.join("\n\n")}\n\nOpen the queue: ${url}`,
    html: layout("A case is waiting for you", lines.map(p).join(""), {
      label: "Open review queue",
      url,
    }),
  };
}

export function noExpertAvailable(adminEmail: string, submission: Submission, reason: string): Message {
  const lines = [
    `No eligible reviewer could be matched to ${submission.id}.`,
    `Specialty: ${submission.specialty}. Priority: ${submission.priority}.`,
    `Reason: ${reason}`,
    `This case is queued and needs manual routing.`,
  ];

  return {
    to: adminEmail,
    channel: "email",
    subject: `${BRAND} — routing failed (${submission.id})`,
    text: lines.join("\n\n"),
    html: layout("Manual routing required", lines.map(p).join("")),
  };
}

/* --- Dispatch ----------------------------------------------------------- */

export class Notifier {
  constructor(private readonly transport: Transport) {}

  /**
   * A failed notification must never fail the operation that triggered it — a
   * verification is still valid if the confirmation email bounces.
   */
  async notify(message: Message): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
    try {
      const { id } = await this.transport.send(message);
      return { ok: true, id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async notifyAll(messages: readonly Message[]): Promise<number> {
    const results = await Promise.all(messages.map((m) => this.notify(m)));
    return results.filter((r) => r.ok).length;
  }
}
