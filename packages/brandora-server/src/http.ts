/**
 * The HTTP plumbing: routing, bodies, cookies, and the single place an error
 * becomes a response.
 *
 * Two decisions here are load-bearing.
 *
 * **Errors are converted in exactly one place.** `handle()` catches everything
 * and sends `BrandoraError.toCustomerJSON()`. A route that lets an exception
 * escape produces a customer-safe body and an admin-only log line, never a
 * stack trace or a supplier's error code on screen (§73). There is no path
 * where a route hand-rolls its own error body, because that is where the
 * exceptions to the rule get made.
 *
 * **The session cookie is signed and HttpOnly.** The value is a random,
 * server-side session token — revocable, unlike a JWT — and the HMAC only
 * exists so a forged or corrupted cookie is rejected without a database read.
 * Signing is not the security boundary; the `sessions` table is.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { BrandoraError, ValidationError, redact, toBrandoraError } from "@brandora/shared";

/* --- Requests and responses ---------------------------------------------- */

export interface RequestContext {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  headers: Record<string, string | string[] | undefined>;
  /** Parsed JSON body, or `{}` for methods without one. Never trusted. */
  body: Record<string, unknown>;
  /**
   * The body exactly as it arrived.
   *
   * Kept because a webhook signature covers the bytes, not the meaning:
   * re-serialising the parsed object reorders keys and invalidates the digest.
   */
  rawBody: string;
  cookies: Record<string, string>;
  /** Whatever the deployment says the client address is. Used for rate limits only. */
  ip: string;
}

export interface CookieSpec {
  name: string;
  value: string;
  maxAgeSeconds?: number;
  /** Delete instead of set. */
  clear?: boolean;
}

export interface HttpResult {
  status: number;
  /** Serialised as JSON. Mutually exclusive with `raw`. */
  body?: unknown;
  raw?: Buffer | string;
  contentType?: string;
  headers?: Record<string, string>;
  cookies?: CookieSpec[];
}

export const json = (status: number, body: unknown, extra?: Partial<HttpResult>): HttpResult => ({
  status,
  body,
  ...extra,
});

export const noContent = (extra?: Partial<HttpResult>): HttpResult => ({ status: 204, ...extra });

/* --- Routing -------------------------------------------------------------- */

export type Handler = (ctx: RequestContext) => Promise<HttpResult> | HttpResult;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): this {
    this.routes.push({
      method: method.toUpperCase(),
      segments: pattern.split("/").filter(Boolean),
      handler,
    });
    return this;
  }

  get = (pattern: string, handler: Handler): this => this.add("GET", pattern, handler);
  post = (pattern: string, handler: Handler): this => this.add("POST", pattern, handler);
  patch = (pattern: string, handler: Handler): this => this.add("PATCH", pattern, handler);
  put = (pattern: string, handler: Handler): this => this.add("PUT", pattern, handler);
  delete = (pattern: string, handler: Handler): this => this.add("DELETE", pattern, handler);

  /**
   * Resolve a path.
   *
   * Returns `matchedPath` separately from `handler` so a request that hits a
   * known path with the wrong verb can answer 405 rather than 404 — a 404 there
   * sends a developer looking for a route that exists.
   */
  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | { pathExists: boolean } {
    const parts = path.split("/").filter(Boolean);
    let pathExists = false;

    for (const route of this.routes) {
      if (route.segments.length !== parts.length) continue;

      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i += 1) {
        const segment = route.segments[i] as string;
        const value = parts[i] as string;
        if (segment.startsWith(":")) {
          params[segment.slice(1)] = decodeURIComponent(value);
        } else if (segment !== value) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;

      pathExists = true;
      if (route.method === method.toUpperCase()) return { handler: route.handler, params };
    }

    return { pathExists };
  }
}

/* --- Cookies -------------------------------------------------------------- */

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    out[name] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export interface CookieOptions {
  /** Off in local development, on everywhere a browser sees https. */
  secure: boolean;
}

export function serialiseCookie(spec: CookieSpec, options: CookieOptions): string {
  const value = spec.clear ? "" : encodeURIComponent(spec.value);
  const attrs = [
    `${spec.name}=${value}`,
    "Path=/",
    "HttpOnly",
    // Lax rather than Strict: a customer following a payment provider's redirect
    // back to Brandora arrives on a cross-site navigation, and Strict would drop
    // their session exactly at the moment they have just paid.
    "SameSite=Lax",
  ];
  if (options.secure) attrs.push("Secure");
  attrs.push(spec.clear ? "Max-Age=0" : `Max-Age=${spec.maxAgeSeconds ?? 60 * 60 * 24 * 14}`);
  return attrs.join("; ");
}

/* --- Cookie signing ------------------------------------------------------- */

const SIGNATURE_SEPARATOR = ".";

export function signValue(value: string, secret: string): string {
  const mac = createHmac("sha256", secret).update(value).digest("base64url");
  return `${value}${SIGNATURE_SEPARATOR}${mac}`;
}

/** Returns the value only if the signature is intact. Constant-time comparison. */
export function unsignValue(signed: string | undefined, secret: string): string | null {
  if (!signed) return null;
  const cut = signed.lastIndexOf(SIGNATURE_SEPARATOR);
  if (cut <= 0) return null;

  const value = signed.slice(0, cut);
  const provided = Buffer.from(signed.slice(cut + 1), "base64url");
  const expected = Buffer.from(createHmac("sha256", secret).update(value).digest("base64url"), "base64url");

  if (provided.length !== expected.length) return null;
  return timingSafeEqual(provided, expected) ? value : null;
}

/* --- Body reading --------------------------------------------------------- */

/** Anything larger is a mistake or an attack; a brand interview is a few kilobytes. */
export const MAX_BODY_BYTES = 256 * 1024;

export async function readJsonBody(
  req: IncomingMessage,
): Promise<{ body: Record<string, unknown>; raw: string }> {
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return { body: {}, raw: "" };

  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      throw new ValidationError("body", `request body exceeds ${MAX_BODY_BYTES} bytes`);
    }
    chunks.push(buf);
  }

  if (size === 0) return { body: {}, raw: "" };

  const raw = Buffer.concat(chunks).toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ValidationError("body", "request body is not valid JSON");
  }

  // A top-level array or string would force every route to re-check the shape.
  // Rejecting here means a route can read `ctx.body.x` without a guard.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ValidationError("body", "request body must be a JSON object");
  }
  return { body: parsed as Record<string, unknown>, raw };
}

/* --- Reading fields off an untrusted body --------------------------------- */

export function requireString(body: Record<string, unknown>, field: string, max = 2_000): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(field, "is required");
  }
  if (value.length > max) throw new ValidationError(field, `must be at most ${max} characters`);
  return value.trim();
}

export function optionalString(body: Record<string, unknown>, field: string, max = 2_000): string | undefined {
  const value = body[field];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new ValidationError(field, "must be text");
  if (value.length > max) throw new ValidationError(field, `must be at most ${max} characters`);
  return value.trim();
}

export function requireInteger(body: Record<string, unknown>, field: string, min: number, max: number): number {
  const value = body[field];
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ValidationError(field, `must be a whole number between ${min} and ${max}`);
  }
  return parsed;
}

export function requireArray(body: Record<string, unknown>, field: string, max = 200): unknown[] {
  const value = body[field];
  if (!Array.isArray(value)) throw new ValidationError(field, "must be a list");
  if (value.length > max) throw new ValidationError(field, `must have at most ${max} entries`);
  return value;
}

/* --- Rate limiting -------------------------------------------------------- */

/**
 * A fixed-window counter, in memory.
 *
 * Deliberately modest: it exists to blunt password guessing and repeated paid
 * generations from one address, not to survive a distributed attack. A single
 * process means it resets on deploy, which is stated rather than hidden — the
 * alternative is a shared store this product does not have yet.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** True when the caller is over budget. */
  exceeded(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      // Opportunistic sweep; the map would otherwise grow with every new address.
      if (this.hits.size > 10_000) {
        for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
      }
      return false;
    }
    entry.count += 1;
    return entry.count > this.limit;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}

export class RateLimitedError extends BrandoraError {
  constructor(detail: string) {
    super("rate.limited", detail, 429);
    this.name = "RateLimitedError";
  }
}

/* --- The adapter between node:http and the router ------------------------- */

export interface ServerLogger {
  /** Admin-facing. Already redacted by the caller. */
  error(message: string): void;
}

export const consoleLogger: ServerLogger = {
  error: (message) => console.error(`[brandora] ${message}`),
};

export interface HandleOptions {
  router: Router;
  cookies: CookieOptions;
  logger: ServerLogger;
  /** Serves a file when no API route matched. Returns null for "not mine". */
  fallback?: (ctx: RequestContext) => Promise<HttpResult | null> | HttpResult | null;
}

export async function handle(req: IncomingMessage, res: ServerResponse, options: HandleOptions): Promise<void> {
  const method = (req.method ?? "GET").toUpperCase();
  const url = new URL(req.url ?? "/", "http://localhost");

  let result: HttpResult;

  try {
    const matched = options.router.match(method, url.pathname);
    const { body, raw } = await readJsonBody(req);

    const ctx: RequestContext = {
      method,
      path: url.pathname,
      params: "params" in matched ? matched.params : {},
      query: url.searchParams,
      headers: req.headers,
      body,
      rawBody: raw,
      cookies: parseCookies(req.headers.cookie),
      ip: clientAddress(req),
    };

    if ("handler" in matched) {
      result = await matched.handler(ctx);
    } else {
      const served = await options.fallback?.(ctx);
      if (served) {
        result = served;
      } else if (matched.pathExists) {
        result = json(405, { error: "method-not-allowed", message: `${method} is not supported here.` });
      } else {
        result = json(404, { error: "not-found", message: "No such endpoint." });
      }
    }
  } catch (err) {
    const error = toBrandoraError(err);
    // The customer gets a sentence; the detail — already redacted on
    // construction — goes to the log, and nowhere near the response.
    options.logger.error(`${method} ${url.pathname} → ${error.status} ${error.technicalDetail}`);
    result = { status: error.status, body: error.toCustomerJSON() };
  }

  send(res, result, options.cookies);
}

function clientAddress(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (first) return (first.split(",")[0] ?? "").trim() || "unknown";
  return req.socket.remoteAddress ?? "unknown";
}

export function send(res: ServerResponse, result: HttpResult, cookieOptions: CookieOptions): void {
  const headers: Record<string, string | string[]> = { ...(result.headers ?? {}) };

  if (result.cookies?.length) {
    headers["Set-Cookie"] = result.cookies.map((c) => serialiseCookie(c, cookieOptions));
  }

  let payload: Buffer | string = "";
  if (result.raw !== undefined) {
    payload = result.raw;
    headers["Content-Type"] = result.contentType ?? "application/octet-stream";
  } else if (result.body !== undefined) {
    payload = JSON.stringify(result.body);
    headers["Content-Type"] = "application/json; charset=utf-8";
  }

  if (payload) headers["Content-Length"] = String(Buffer.byteLength(payload));

  // Nothing produced by the API is cacheable: it is all per-session.
  if (result.raw === undefined) headers["Cache-Control"] = "no-store";

  res.writeHead(result.status, headers);
  if (payload) res.end(payload);
  else res.end();
}

/** Log an unexpected failure without letting the message itself carry a secret. */
export const safeLog = (logger: ServerLogger, context: string, err: unknown): void => {
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  logger.error(`${context}: ${redact(detail)}`);
};
