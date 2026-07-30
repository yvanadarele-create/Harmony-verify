import { isAdminEmail } from "@harmony/config";
import type { UserRole } from "@harmony/shared";

/**
 * Authorisation policy.
 *
 * Every rule that decides who may see what lives here, as a pure function over a
 * principal and a resource. Two consequences, both deliberate:
 *
 *   - Access control is testable without spinning up a server, so the expert
 *     portal being private is a property with a test behind it rather than a
 *     claim in a README.
 *   - There is one place to read to answer "who can see an expert's cases?",
 *     instead of a route handler here and a template condition there.
 *
 * The default is denial. `authorize()` returns a decision object rather than a
 * boolean so a refusal always carries a reason for the audit log.
 */

export interface Principal {
  userId: string;
  email: string;
  role: UserRole;
  /** Set when this user is an expert. Null for customers and admins. */
  expertId?: string | null;
  /** An expert who has not signed cannot reach case material. */
  agreementSigned?: boolean;
}

export interface Decision {
  allowed: boolean;
  reason: string;
  /** HTTP status a route should return on refusal. */
  status: 200 | 401 | 403 | 404;
}

const allow = (reason: string): Decision => ({ allowed: true, reason, status: 200 });
const deny = (reason: string, status: 401 | 403 | 404 = 403): Decision => ({
  allowed: false,
  reason,
  status,
});

export const isAdmin = (principal: Principal | null): boolean => principal?.role === "admin";

/**
 * True when this account should hold the admin role.
 *
 * Checked against ADMIN_EMAIL rather than a database column so that a compromised
 * database row cannot mint an administrator.
 */
export const shouldBeAdmin = (email: string): boolean => isAdminEmail(email);

/* --- Areas --------------------------------------------------------------- */

export const AREAS = ["public", "customer", "expert", "admin"] as const;
export type Area = (typeof AREAS)[number];

/**
 * Which principal may enter which area of the product.
 *
 * The expert portal is private in the strict sense: not "hidden", not
 * "unlinked from the navigation" — no customer can enter it, and an admin
 * entering it does so under an audited role, not by being logged in. Everything
 * a customer needs is in the customer area, so there is no legitimate reason for
 * a customer session to be in expert routes at all.
 */
export function canEnterArea(principal: Principal | null, area: Area): Decision {
  if (area === "public") return allow("Public area.");
  if (!principal) return deny("Sign in required.", 401);

  switch (area) {
    case "customer":
      return principal.role === "customer" || principal.role === "admin"
        ? allow(`${principal.role} may enter the customer area.`)
        : deny("The customer dashboard is for customer accounts.");

    case "expert":
      if (principal.role === "expert") {
        return principal.expertId
          ? allow("Expert may enter their own portal.")
          : deny("Expert account is not linked to an expert profile.", 403);
      }
      return principal.role === "admin"
        ? allow("Admin oversight of the expert portal.")
        : // 404 rather than 403: a customer probing expert routes learns only that
          // there is nothing there, not that there is something they cannot have.
          deny("The expert portal is private to verified experts.", 404);

    case "admin":
      return isAdmin(principal) ? allow("Administrator.") : deny("Administrators only.", 404);
  }
}

/* --- Resources ----------------------------------------------------------- */

export interface OwnedResource {
  /** The customer who created it, where that applies. */
  customerId?: string | null;
  /** The expert it is assigned to, where that applies. */
  expertId?: string | null;
}

/** A submission: visible to the customer who filed it, the assigned expert, and admins. */
export function canReadSubmission(principal: Principal | null, submission: OwnedResource): Decision {
  if (!principal) return deny("Sign in required.", 401);
  if (isAdmin(principal)) return allow("Administrator.");

  if (principal.role === "customer") {
    return submission.customerId === principal.userId
      ? allow("Customer owns this submission.")
      : deny("Not your submission.", 404);
  }

  if (principal.role === "expert") {
    if (!principal.expertId || submission.expertId !== principal.expertId) {
      return deny("Not assigned to you.", 404);
    }
    // Signing gates the clinical content itself, not merely the ability to be paid.
    return principal.agreementSigned
      ? allow("Assigned expert.")
      : deny("Sign the Expert Agreement before opening case material.", 403);
  }

  return deny("No rule permits this.", 403);
}

/** A review is the expert's own work product. Customers see the report, not the draft. */
export function canReadReview(principal: Principal | null, review: OwnedResource): Decision {
  if (!principal) return deny("Sign in required.", 401);
  if (isAdmin(principal)) return allow("Administrator.");
  if (principal.role !== "expert") return deny("Reviews are visible to their author.", 404);
  return principal.expertId && review.expertId === principal.expertId
    ? allow("Own review.")
    : deny("Not your review.", 404);
}

export function canWriteReview(principal: Principal | null, review: OwnedResource): Decision {
  const read = canReadReview(principal, review);
  if (!read.allowed) return read;
  if (isAdmin(principal)) return allow("Administrator.");
  return principal?.agreementSigned
    ? allow("Own review, agreement signed.")
    : deny("Sign the Expert Agreement before submitting a review.", 403);
}

/**
 * Wallet and payout details.
 *
 * Stricter than everything else: an expert reads their own, and nobody else does
 * — administrators included. An admin can see that a payout was requested and can
 * approve it, but has no route that returns a bank account number. The one
 * function that decrypts an account number is called by the payout worker, never
 * by a request handler.
 */
export function canReadWallet(principal: Principal | null, wallet: OwnedResource): Decision {
  if (!principal) return deny("Sign in required.", 401);
  if (principal.role !== "expert") return deny("Wallets belong to experts.", 404);
  if (!principal.expertId || wallet.expertId !== principal.expertId) {
    return deny("Not your wallet.", 404);
  }
  return allow("Own wallet.");
}

export function canReadPayoutDetails(principal: Principal | null, details: OwnedResource): Decision {
  const wallet = canReadWallet(principal, details);
  if (!wallet.allowed) return wallet;
  return allow("Own payout details — last four digits only.");
}

/**
 * Payout details may only be *entered* by an approved expert who has signed.
 *
 * This is the server-side half of the punch-list rule that bank details are never
 * collected on the public application form. Even if a form were reintroduced at
 * `/experts/apply`, an unauthenticated request could not get past this.
 */
export function canWritePayoutDetails(principal: Principal | null, details: OwnedResource): Decision {
  const read = canReadWallet(principal, details);
  if (!read.allowed) return read;
  return principal?.agreementSigned
    ? allow("Approved expert with a signed agreement.")
    : deny("Payout details can only be added after the Expert Agreement is signed.", 403);
}

/* --- Route guard --------------------------------------------------------- */

export interface RouteRule {
  /** Path prefix this rule protects, e.g. "/expert". */
  prefix: string;
  area: Area;
}

/**
 * Prefix rules for the whole product, longest first so `/admin` cannot be matched
 * by a shorter public rule.
 */
export const ROUTE_RULES: readonly RouteRule[] = [
  { prefix: "/admin", area: "admin" },
  { prefix: "/expert", area: "expert" },
  { prefix: "/dashboard", area: "customer" },
  { prefix: "/api/admin", area: "admin" },
  { prefix: "/api/expert", area: "expert" },
  { prefix: "/api/submissions", area: "customer" },
];

export function areaForPath(path: string): Area {
  const normalised = path.toLowerCase();
  const match = [...ROUTE_RULES]
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((rule) => normalised === rule.prefix || normalised.startsWith(`${rule.prefix}/`));
  return match?.area ?? "public";
}

/** The single call a request handler makes before doing anything else. */
export function authorize(principal: Principal | null, path: string): Decision {
  return canEnterArea(principal, areaForPath(path));
}
