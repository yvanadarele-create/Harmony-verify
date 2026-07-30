import type { VerificationReport } from "./report.js";

/**
 * The "your verification is ready" notification.
 *
 * The email is a doorbell, not a delivery. It carries no clinical content, no
 * findings, no verdict and no attachment — only that a report exists and where
 * to sign in and get it.
 *
 * That is a deliberate constraint rather than a limitation. An inbox is the
 * easiest place in any organisation to leak a document from: it is forwarded,
 * auto-archived, synced to phones, and searched by tools nobody inventoried.
 * A report that only exists behind authentication can be access-logged, revoked
 * and retention-managed. One that was emailed cannot.
 */

export interface NotificationInput {
  report: VerificationReport;
  recipientName?: string | null;
  /** Absolute link to the report inside the platform. */
  reportUrl: string;
}

export interface Notification {
  subject: string;
  text: string;
  html: string;
}

export function verificationReadyEmail(input: NotificationInput): Notification {
  const { report, reportUrl } = input;
  const greeting = input.recipientName ? `Hello ${input.recipientName},` : "Hello,";

  const subject = `Your verification is ready — ${report.reference}`;

  const lines = [
    greeting,
    "",
    `The clinical verification you requested is complete and waiting for you on the platform.`,
    "",
    `Reference: ${report.reference}`,
    `Submission: ${report.subtitle}`,
    `Issued: ${report.issuedAt}`,
    "",
    `Sign in to read and download it as PDF or Word:`,
    reportUrl,
    "",
    "The findings are not included in this email. Clinical material stays behind your account so that access to it is logged and revocable — an emailed report is neither.",
    "",
    "Thank you for trusting Harmony Verify with the reliability of your AI outputs.",
    "",
    "— Harmony Verify",
    "This message contains no clinical content. Harmony Verify does not practise medicine and does not provide medical advice.",
  ];

  const html = `<!doctype html>
<html lang="en"><body style="margin:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#101B36">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FA;padding:32px 16px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E1E6EF;border-radius:4px">
  <tr><td style="background:#0A1325;padding:22px 28px;border-radius:3px 3px 0 0">
    <div style="font-family:Georgia,serif;font-size:16px;letter-spacing:.08em;color:#E9EDF5">HARMONY <span style="color:#D4AF37">VERIFY</span></div>
    <div style="font-size:10px;letter-spacing:.16em;color:#8595B0;margin-top:4px;text-transform:uppercase">Clinical AI Assurance</div>
  </td></tr>
  <tr><td style="padding:28px">
    <p style="margin:0 0 16px;font-size:15px">${escapeHtml(greeting)}</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6">
      The clinical verification you requested is complete and waiting for you on the platform.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #E1E6EF;border-radius:3px;margin:0 0 24px">
      <tr><td style="padding:10px 14px;font-size:13px;color:#59667F;border-bottom:1px solid #E1E6EF">Reference</td>
          <td style="padding:10px 14px;font-size:13px;font-weight:600;border-bottom:1px solid #E1E6EF">${escapeHtml(report.reference)}</td></tr>
      <tr><td style="padding:10px 14px;font-size:13px;color:#59667F;border-bottom:1px solid #E1E6EF">Submission</td>
          <td style="padding:10px 14px;font-size:13px;font-weight:600;border-bottom:1px solid #E1E6EF">${escapeHtml(report.subtitle)}</td></tr>
      <tr><td style="padding:10px 14px;font-size:13px;color:#59667F">Issued</td>
          <td style="padding:10px 14px;font-size:13px;font-weight:600">${escapeHtml(report.issuedAt)}</td></tr>
    </table>
    <p style="margin:0 0 26px">
      <a href="${escapeHtml(reportUrl)}" style="display:inline-block;background:#D4AF37;color:#1B1405;text-decoration:none;font-weight:600;font-size:14px;letter-spacing:.06em;padding:13px 26px;border-radius:3px">SIGN IN AND DOWNLOAD</a>
    </p>
    <p style="margin:0 0 18px;font-size:13px;line-height:1.6;color:#59667F">
      The findings are not included in this email. Clinical material stays behind your account so
      that access to it is logged and revocable — an emailed report is neither.
    </p>
    <p style="margin:0;font-size:14px;line-height:1.6">
      Thank you for trusting Harmony Verify with the reliability of your AI outputs.
    </p>
  </td></tr>
  <tr><td style="padding:18px 28px;border-top:1px solid #E1E6EF;font-size:11px;line-height:1.6;color:#8595B0">
    This message contains no clinical content. Harmony Verify does not practise medicine and does
    not provide medical advice.
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  return { subject, text: lines.join("\n"), html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Clinical terms that must never appear in a notification.
 *
 * Checked rather than trusted: the email template is the kind of file someone
 * later "improves" by adding a helpful summary of the verdict, which quietly
 * turns a doorbell into a delivery.
 */
const FORBIDDEN = [
  "hallucination",
  "unsafe",
  "incorrect",
  "contraindicat",
  "dose",
  "dosage",
  "diagnos",
  "verdict",
  "patient",
];

export function containsClinicalContent(notification: Notification): string[] {
  const haystack = `${notification.subject} ${notification.text} ${notification.html}`.toLowerCase();
  return FORBIDDEN.filter((term) => haystack.includes(term));
}
