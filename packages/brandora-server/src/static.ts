/**
 * Serving the front end.
 *
 * The site and the API share an origin, which is what makes an HttpOnly,
 * SameSite=Lax session cookie work without CORS, preflights or a token in
 * `localStorage` — the last of which is readable by any script that manages to
 * run on the page.
 *
 * The path handling is the security-relevant part. Every request path is
 * resolved and then checked to be *inside* the root before anything is read,
 * so `../../../etc/passwd` and its encoded variants resolve out of the root and
 * are refused. Checking the string for ".." instead would be one encoding away
 * from being wrong.
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { ServerResponse } from "node:http";

import type { RequestContext } from "./http.js";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

/** Long for fingerprinted assets, short for anything a deploy can change. */
function cacheControl(pathname: string): string {
  if (/^\/assets\/(fonts|video)\//.test(pathname)) return "public, max-age=31536000, immutable";
  if (/^\/assets\//.test(pathname)) return "public, max-age=604800";
  if (/^\/(data|locales)\//.test(pathname)) return "public, max-age=300, must-revalidate";
  return "no-cache";
}

export interface StaticOptions {
  root: string;
  /** Sent on every static response. The API sets its own. */
  securityHeaders?: Record<string, string>;
}

export interface StaticFile {
  absolutePath: string;
  contentType: string;
  size: number;
  headers: Record<string, string>;
}

/**
 * Resolve a URL path to a file inside the root, or null.
 *
 * `/create` finds `create.html`, so the site's links stay clean without a
 * rewrite rule that has to be kept in sync with the router.
 */
export function resolveStaticFile(root: string, pathname: string): StaticFile | null {
  const rootAbsolute = resolve(root);

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const relative = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const candidates =
    relative === "/" || relative === "" || relative === sep
      ? ["index.html"]
      : [relative.replace(/^[/\\]+/, ""), `${relative.replace(/^[/\\]+/, "")}.html`, join(relative.replace(/^[/\\]+/, ""), "index.html")];

  for (const candidate of candidates) {
    const absolute = resolve(rootAbsolute, candidate);

    // The containment check, done on resolved paths rather than on the raw
    // string. Anything that escapes the root simply is not a candidate.
    if (absolute !== rootAbsolute && !absolute.startsWith(rootAbsolute + sep)) continue;
    if (!existsSync(absolute)) continue;

    const stat = statSync(absolute);
    if (!stat.isFile()) continue;

    return {
      absolutePath: absolute,
      contentType: CONTENT_TYPES[extname(absolute).toLowerCase()] ?? "application/octet-stream",
      size: stat.size,
      headers: { "Cache-Control": cacheControl(decoded) },
    };
  }

  return null;
}

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=()",
};

/**
 * Stream a static file.
 *
 * Streamed rather than buffered because the landing film is several megabytes,
 * and reading it into memory once per request is how a small host runs out of
 * it. Range requests are supported so a browser can seek in the video.
 */
export function sendStatic(
  res: ServerResponse,
  file: StaticFile,
  options: { rangeHeader?: string | string[] | undefined; extraHeaders?: Record<string, string> } = {},
): void {
  const headers: Record<string, string> = {
    "Content-Type": file.contentType,
    "Accept-Ranges": "bytes",
    ...SECURITY_HEADERS,
    ...file.headers,
    ...(options.extraHeaders ?? {}),
  };

  const rangeRaw = Array.isArray(options.rangeHeader) ? options.rangeHeader[0] : options.rangeHeader;
  const range = rangeRaw ? /^bytes=(\d*)-(\d*)$/.exec(rangeRaw) : null;

  if (range) {
    const startRaw = range[1] ?? "";
    const endRaw = range[2] ?? "";
    const start = startRaw === "" ? Math.max(0, file.size - Number(endRaw || 0)) : Number(startRaw);
    const end = startRaw === "" || endRaw === "" ? file.size - 1 : Math.min(Number(endRaw), file.size - 1);

    if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < file.size) {
      headers["Content-Range"] = `bytes ${start}-${end}/${file.size}`;
      headers["Content-Length"] = String(end - start + 1);
      res.writeHead(206, headers);
      createReadStream(file.absolutePath, { start, end }).pipe(res);
      return;
    }
  }

  headers["Content-Length"] = String(file.size);
  res.writeHead(200, headers);
  createReadStream(file.absolutePath).pipe(res);
}

/** True when this path should never reach the static handler. */
export const isApiPath = (ctx: RequestContext): boolean => ctx.path.startsWith("/api/");
