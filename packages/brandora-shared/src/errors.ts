/**
 * Errors, and the wall between what a customer sees and what an admin sees.
 *
 * Spec §73 is blunt about this: a customer must never be shown
 * "AliExpress error 403928…". They are shown a sentence they can act on; the
 * technical detail is kept on the error object for the admin view and the logs.
 *
 * The second job of this file is making sure a credential can never ride out
 * inside an error message. Supplier APIs habitually echo the request — including
 * the signed query string — back in their failure bodies, so anything that has
 * touched a supplier response goes through `redact()` before it is logged.
 */

/** Message keys, resolved through @brandora/i18n so errors translate too (§23). */
export const CUSTOMER_MESSAGES = {
  "sourcing.unavailable": "We couldn't retrieve this product right now. Please try another option.",
  "sourcing.no-results": "We couldn't find a match for that yet. Try a different quantity or style.",
  "freight.unavailable": "Delivery estimate unavailable",
  "brand.generation-failed": "We couldn't finish your brand just now. Your answers are saved — try again.",
  "quote.expired": "This quote has expired. We can prepare a fresh one for you.",
  "order.not-found": "We couldn't find that order.",
  "auth.required": "Please sign in to continue.",
  "auth.weak-password": "Please choose a longer password — at least 10 characters.",
  "auth.forbidden": "You don't have access to this.",
  "input.invalid": "Something in that form didn't look right. Please check and try again.",
  "rate.limited": "That's a lot of requests. Please wait a moment and try again.",
  "internal": "Something went wrong on our side. We're on it.",
} as const;

export type CustomerMessageKey = keyof typeof CUSTOMER_MESSAGES;

export class BrandoraError extends Error {
  readonly customerMessageKey: CustomerMessageKey;
  readonly status: number;
  /** Admin-only. Never serialise this toward a browser. */
  readonly technicalDetail: string;

  constructor(
    customerMessageKey: CustomerMessageKey,
    technicalDetail: string,
    status = 500,
    options?: { cause?: unknown },
  ) {
    super(CUSTOMER_MESSAGES[customerMessageKey], options);
    this.name = "BrandoraError";
    this.customerMessageKey = customerMessageKey;
    this.status = status;
    this.technicalDetail = redact(technicalDetail);
  }

  /** Exactly what may cross the wire to a customer. */
  toCustomerJSON(): { error: CustomerMessageKey; message: string } {
    return { error: this.customerMessageKey, message: CUSTOMER_MESSAGES[this.customerMessageKey] };
  }

  /** The admin view, already redacted. */
  toAdminJSON(): { error: CustomerMessageKey; status: number; detail: string } {
    return { error: this.customerMessageKey, status: this.status, detail: this.technicalDetail };
  }
}

export class ValidationError extends BrandoraError {
  constructor(readonly field: string, detail: string) {
    super("input.invalid", `${field}: ${detail}`, 400);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends BrandoraError {
  constructor(kind: string, id: string) {
    super("order.not-found", `${kind} ${id} not found`, 404);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends BrandoraError {
  constructor(detail: string) {
    super("auth.forbidden", detail, 403);
    this.name = "ForbiddenError";
  }
}

/**
 * Strip anything credential-shaped from a string bound for a log or an admin
 * screen.
 *
 * Deliberately pattern-based rather than a list of known secrets: the module
 * that holds the real values must never be imported here, or a stack trace from
 * this file could carry them. Matching on shape catches the signed query strings
 * and bearer tokens that supplier errors echo back, including ones nobody
 * thought to register.
 */
export function redact(input: string): string {
  return input
    .replace(/\b(app_?secret|access_?token|refresh_?token|api_?key|password|sign|secret)\b(\s*[=:]\s*|%3D)"?([A-Za-z0-9._~+/-]{8,})"?/gi, "$1$2[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi, "Bearer [redacted]")
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, "[redacted]");
}

/**
 * Normalise anything thrown into a BrandoraError.
 *
 * The catch-all deliberately does not reuse the thrown message as the customer
 * message — that is exactly how a raw supplier error reaches a customer.
 */
export function toBrandoraError(err: unknown, fallback: CustomerMessageKey = "internal"): BrandoraError {
  if (err instanceof BrandoraError) return err;
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return new BrandoraError(fallback, detail, 500, { cause: err });
}
