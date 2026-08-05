/**
 * What every route handler is given: the database, where uploads live, how to send
 * a notification, and the rate limiters. Assembled once in `createApp`.
 */
import type { Db } from "@delices/db";
import type { Transport } from "./notify.js";
import { RateLimiter } from "./rate-limit.js";

export interface AppOptions {
  db: Db;
  /** Directory holding the static site (apps/delices). */
  webRoot: string;
  /** Directory holding uploaded images — outside the web root. */
  uploadDir: string;
  transport?: Transport;
  /** Set when the site is served over HTTPS, so the session cookie is `Secure`. */
  secureCookies?: boolean;
}

export interface AppContext {
  db: Db;
  webRoot: string;
  uploadDir: string;
  transport: Transport;
  secureCookies: boolean;
  limits: {
    /** Public form submissions. */
    submit: RateLimiter;
    upload: RateLimiter;
    login: RateLimiter;
    track: RateLimiter;
  };
}

export const SESSION_COOKIE = "delices_session";

export function buildLimiters(): AppContext["limits"] {
  return {
    submit: new RateLimiter({ windowMs: 60 * 60_000, max: 20 }),
    upload: new RateLimiter({ windowMs: 60 * 60_000, max: 30 }),
    login: new RateLimiter({ windowMs: 15 * 60_000, max: 10 }),
    track: new RateLimiter({ windowMs: 10 * 60_000, max: 30 }),
  };
}
