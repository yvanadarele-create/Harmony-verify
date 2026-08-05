/**
 * Small HTTP helpers. Deliberately not a framework: the API is a few dozen routes
 * over `node:http`, and a dependency-free server is one less thing to keep patched.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export const JSON_BODY_LIMIT = 128 * 1024;

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  ip: string;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

export const ok = (res: ServerResponse, body: unknown): void => sendJson(res, 200, body);

export const badRequest = (res: ServerResponse, errors: unknown, message = "Requête invalide."): void =>
  sendJson(res, 400, { error: message, errors });

export const unauthorized = (res: ServerResponse): void =>
  sendJson(res, 401, { error: "Authentification requise." });

export const notFound = (res: ServerResponse, message = "Introuvable."): void =>
  sendJson(res, 404, { error: message });

export const conflict = (res: ServerResponse, message: string): void =>
  sendJson(res, 409, { error: message });

export const tooMany = (res: ServerResponse): void =>
  sendJson(res, 429, { error: "Trop de demandes. Merci de réessayer dans quelques minutes." });

export const serverError = (res: ServerResponse): void =>
  sendJson(res, 500, { error: "Une erreur est survenue. Merci de réessayer." });

/** Reads a JSON body, refusing anything oversized before it is buffered in full. */
export async function readJson(req: IncomingMessage, limit = JSON_BODY_LIMIT): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) throw new PayloadTooLarge();
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new BadJson();
  }
}

export class PayloadTooLarge extends Error {
  constructor() {
    super("payload too large");
    this.name = "PayloadTooLarge";
  }
}

export class BadJson extends Error {
  constructor() {
    super("invalid json");
    this.name = "BadJson";
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function setCookie(
  res: ServerResponse,
  name: string,
  value: string,
  opts: { maxAge?: number; secure?: boolean } = {},
): void {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.secure) parts.push("Secure");
  appendHeader(res, "Set-Cookie", parts.join("; "));
}

export function clearCookie(res: ServerResponse, name: string, secure = false): void {
  const parts = [`${name}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (secure) parts.push("Secure");
  appendHeader(res, "Set-Cookie", parts.join("; "));
}

function appendHeader(res: ServerResponse, name: string, value: string): void {
  const existing = res.getHeader(name);
  if (existing === undefined) res.setHeader(name, value);
  else if (Array.isArray(existing)) res.setHeader(name, [...existing, value]);
  else res.setHeader(name, [String(existing), value]);
}

export function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]!.trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

/** Reads a query parameter as a trimmed string, or undefined when absent/empty. */
export function query(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name);
  if (value === null) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function queryBool(url: URL, name: string): boolean {
  const value = url.searchParams.get(name);
  return value === "1" || value === "true";
}
