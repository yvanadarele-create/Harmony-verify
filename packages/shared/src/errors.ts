/**
 * Typed application errors. Every one carries an HTTP status so the API layer can map
 * a thrown domain error straight to a response without a translation table.
 */

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, code: string, status: number, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, "validation_error", 400, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(message, "unauthorized", 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have access to this resource") {
    super(message, "forbidden", 403);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super(`${resource} not found`, "not_found", 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, "conflict", 409, details);
  }
}

/** No eligible reviewer — distinct from a generic conflict so callers can queue and retry. */
export class NoEligibleExpertError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, "no_eligible_expert", 503, details);
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
