/**
 * Authorisation policy.
 *
 * Every rule about who may see or do what lives here, as pure functions over a
 * principal and a resource. Two consequences, both deliberate:
 *
 *   - Access control is testable without starting a server, so "a customer
 *     cannot read another customer's order" is a property with a test behind it
 *     rather than a sentence in a README.
 *   - There is one file to read to answer "who can approve a quote?", instead of
 *     a route handler here and a template condition there.
 *
 * The default is denial, and `authorize` returns a decision carrying a reason so
 * a refusal can be logged and explained without reconstructing why.
 */

import type { UserRole } from "@brandora/shared";

export interface Principal {
  userId: string;
  email: string;
  role: UserRole;
}

export interface Decision {
  allowed: boolean;
  /** Never shown to the customer — for the audit log and the admin view. */
  reason: string;
  status: 200 | 401 | 403 | 404;
}

const allow = (reason: string): Decision => ({ allowed: true, reason, status: 200 });
const deny = (reason: string, status: 401 | 403 | 404 = 403): Decision => ({
  allowed: false,
  reason,
  status,
});

export const isAdmin = (principal: Principal | null | undefined): boolean =>
  principal?.role === "admin";

/** Anything a route can be asked to authorise. */
export type Action =
  | "project:create"
  | "project:read"
  | "project:update"
  | "project:generate"
  | "quote:create"
  | "quote:read"
  | "quote:approve"
  | "order:create"
  | "order:read"
  | "order:update-fulfillment"
  | "admin:read"
  | "admin:write";

/** The minimum a resource must expose for an ownership decision. */
export interface OwnedResource {
  userId: string;
}

/**
 * The single entry point.
 *
 * `resource` is required for every action that names one. Passing `null` where
 * a resource is expected denies rather than allows — a missing record and a
 * forbidden one both end the request, and treating "not loaded" as "permitted"
 * is the bug that turns a typo into a data breach.
 */
export function authorize(
  principal: Principal | null,
  action: Action,
  resource?: OwnedResource | null,
): Decision {
  if (!principal) return deny(`anonymous request for ${action}`, 401);

  // Admins are trusted for read and for the operational actions the admin
  // dashboard exists to perform. They are *not* silently granted every action:
  // the switch below still has to name each one.
  switch (action) {
    case "admin:read":
    case "admin:write":
      return isAdmin(principal)
        ? allow(`admin ${principal.userId} performed ${action}`)
        : deny(`user ${principal.userId} (${principal.role}) attempted ${action}`, 403);

    case "project:create":
    case "quote:create":
    case "order:create":
      return allow(`${principal.role} ${principal.userId} performed ${action}`);

    case "project:read":
    case "project:update":
    case "project:generate":
    case "quote:read":
    case "quote:approve":
    case "order:read": {
      if (!resource) return deny(`${action} with no resource loaded`, 404);
      if (resource.userId === principal.userId) {
        return allow(`owner ${principal.userId} performed ${action}`);
      }
      if (isAdmin(principal) && (action === "project:read" || action === "quote:read" || action === "order:read")) {
        return allow(`admin ${principal.userId} read another user's resource`);
      }
      // 404, not 403. Telling someone "that exists but is not yours" confirms
      // the id is real, which is exactly what an attacker enumerating ids wants.
      return deny(
        `user ${principal.userId} attempted ${action} on a resource owned by ${resource.userId}`,
        404,
      );
    }

    // Moving an order through fulfilment spends money and makes promises to a
    // customer. It is an operator action, never a customer one — the same rule
    // the order state machine enforces in @brandora/quotes.
    case "order:update-fulfillment":
      return isAdmin(principal)
        ? allow(`admin ${principal.userId} updated fulfilment`)
        : deny(`user ${principal.userId} attempted to change fulfilment`, 403);

    default: {
      // Exhaustiveness: adding an Action without a rule fails to compile rather
      // than silently falling through to a permissive default.
      const unreachable: never = action;
      return deny(`unknown action ${String(unreachable)}`, 403);
    }
  }
}

/** Throwing form, for route handlers that would otherwise repeat the check. */
export class AuthorizationError extends Error {
  constructor(readonly decision: Decision) {
    super(decision.reason);
    this.name = "AuthorizationError";
  }
  get status(): number {
    return this.decision.status;
  }
}

export function requireAuthorized(
  principal: Principal | null,
  action: Action,
  resource?: OwnedResource | null,
): void {
  const decision = authorize(principal, action, resource);
  if (!decision.allowed) throw new AuthorizationError(decision);
}
