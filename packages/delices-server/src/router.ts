/**
 * A route table: method, pattern, handler. Patterns use `:name` segments.
 */
import type { RequestContext } from "./http.js";

export type Handler = (ctx: RequestContext) => Promise<void> | void;

export interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

export function route(method: string, pattern: string, handler: Handler): Route {
  return {
    method,
    segments: pattern.split("/").filter((segment) => segment !== ""),
    handler,
  };
}

export interface Match {
  handler: Handler;
  params: Record<string, string>;
}

export function matchRoute(routes: readonly Route[], method: string, pathname: string): Match | null {
  const parts = pathname.split("/").filter((segment) => segment !== "");
  let methodMismatch = false;
  for (const candidate of routes) {
    if (candidate.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < candidate.segments.length; i++) {
      const expected = candidate.segments[i]!;
      const actual = parts[i]!;
      if (expected.startsWith(":")) {
        params[expected.slice(1)] = decodeURIComponent(actual);
      } else if (expected !== actual) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    if (candidate.method !== method) {
      methodMismatch = true;
      continue;
    }
    return { handler: candidate.handler, params };
  }
  return methodMismatch ? { handler: methodNotAllowed, params: {} } : null;
}

const methodNotAllowed: Handler = ({ res }) => {
  res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "Méthode non autorisée." }));
};
