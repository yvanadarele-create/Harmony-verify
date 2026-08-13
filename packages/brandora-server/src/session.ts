/**
 * Turning a cookie into a principal, and a principal into an authorisation.
 *
 * Every protected route in `routes.ts` starts with `requireUser(ctx)`. That is
 * the only way to obtain a user id, so there is no route shape where a caller
 * supplies their own `userId` in the body — the identifier used in a query
 * comes from the session row, never from the request.
 */

import { type Principal, sessionIsLive } from "@brandora/auth";
import type { Repositories, UserRow } from "@brandora/database";
import { BrandoraError, ForbiddenError } from "@brandora/shared";

import { type RequestContext, unsignValue } from "./http.js";

export const SESSION_COOKIE = "brandora_session";

export class UnauthenticatedError extends BrandoraError {
  constructor(detail: string) {
    super("auth.required", detail, 401);
    this.name = "UnauthenticatedError";
  }
}

export interface SessionContext {
  repos: Repositories;
  authSecret: string;
}

/**
 * Resolve the signed-in user, or null.
 *
 * An expired session is destroyed on sight rather than left to a sweep: the
 * request that discovers it is the cheapest possible moment to clean it up, and
 * leaving it means a stale row keeps answering "found" to every later lookup
 * until the sweep runs.
 */
export function currentUser(ctx: RequestContext, session: SessionContext): UserRow | null {
  const token = unsignValue(ctx.cookies[SESSION_COOKIE], session.authSecret);
  if (!token) return null;

  const row = session.repos.sessions.find(token);
  if (!row) return null;

  if (!sessionIsLive(row.expiresAt)) {
    session.repos.sessions.destroy(token);
    return null;
  }

  return session.repos.users.findById(row.userId);
}

export function requireUser(ctx: RequestContext, session: SessionContext): UserRow {
  const user = currentUser(ctx, session);
  if (!user) throw new UnauthenticatedError(`${ctx.method} ${ctx.path} without a live session`);
  return user;
}

/**
 * Require an administrator.
 *
 * A signed-in customer hitting an admin route gets 403, not 404: unlike a
 * resource id, the *existence* of `/api/admin/orders` is not a secret, and a
 * 404 here would send a genuine admin looking for a typo.
 */
export function requireAdmin(ctx: RequestContext, session: SessionContext): UserRow {
  const user = requireUser(ctx, session);
  if (user.role !== "admin") {
    throw new ForbiddenError(`user ${user.id} (${user.role}) attempted ${ctx.method} ${ctx.path}`);
  }
  return user;
}

export const principalOf = (user: UserRow): Principal => ({
  userId: user.id,
  email: user.email,
  role: user.role,
});

/** What a browser is allowed to know about the signed-in account. */
export function publicUser(user: UserRow): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    locale: user.locale,
    currency: user.currency,
    country: user.country ?? null,
  };
}
