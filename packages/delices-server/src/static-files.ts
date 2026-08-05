/**
 * Static hosting for the site itself.
 *
 * Clean URLs (`/nos-creations` → `nos-creations.html`) so links read well, and a
 * resolved-path check on every request so no amount of `../` escapes the web root.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, resolve, extname, sep } from "node:path";
import type { ServerResponse } from "node:http";

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

const IMMUTABLE = new Set([".woff2"]);

/**
 * Files that live in the web root for tooling reasons and are not site content.
 * A browser asking for one is either a mistake or a probe; either way it gets a 404.
 */
const DENIED = new Set(["package.json", "turbo.json", "tsconfig.json", "package-lock.json"]);

/** Resolves a URL path to a file inside `root`, or null when it escapes or is absent. */
async function locate(root: string, pathname: string): Promise<string | null> {
  const decoded = decodeURIComponent(pathname);
  if (decoded.includes("\0")) return null;
  const segments = decoded.split("/").filter(Boolean);
  // No dotfiles, and nothing from the deny list, at any depth.
  if (segments.some((segment) => segment.startsWith("."))) return null;
  if (segments.some((segment) => DENIED.has(segment.toLowerCase()))) return null;
  const candidates = decoded.endsWith("/")
    ? [join(decoded, "index.html")]
    : [decoded, `${decoded}.html`, join(decoded, "index.html")];

  for (const candidate of candidates) {
    const full = resolve(root, `.${candidate.startsWith("/") ? candidate : `/${candidate}`}`);
    if (full !== root && !full.startsWith(root + sep)) continue;
    try {
      const info = await stat(full);
      if (info.isFile()) return full;
    } catch {
      // keep trying the other candidates
    }
  }
  return null;
}

export async function serveStatic(
  res: ServerResponse,
  root: string,
  pathname: string,
  opts: { fallback404?: string } = {},
): Promise<boolean> {
  const file = await locate(root, pathname === "/" ? "/index.html" : pathname);
  if (!file) {
    if (opts.fallback404) {
      const notFoundPage = await locate(root, `/${opts.fallback404}`);
      if (notFoundPage) {
        await stream(res, notFoundPage, 404);
        return true;
      }
    }
    return false;
  }
  await stream(res, file, 200);
  return true;
}

async function stream(res: ServerResponse, file: string, status: number): Promise<void> {
  const ext = extname(file).toLowerCase();
  const info = await stat(file);
  res.writeHead(status, {
    "Content-Type": TYPES[ext] ?? "application/octet-stream",
    "Content-Length": info.size,
    "Cache-Control": IMMUTABLE.has(ext)
      ? "public, max-age=31536000, immutable"
      : ext === ".html"
        ? "no-cache"
        : "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  createReadStream(file).pipe(res);
}

/** Uploaded images live outside the web root and are served read-only from here. */
export async function serveUpload(
  res: ServerResponse,
  uploadDir: string,
  pathname: string,
): Promise<boolean> {
  const name = pathname.replace(/^\/uploads\//, "");
  if (!/^[a-f0-9]{24}\.(jpg|png|webp)$/i.test(name)) return false;
  const full = resolve(uploadDir, name);
  if (!full.startsWith(resolve(uploadDir) + sep)) return false;
  try {
    const info = await stat(full);
    if (!info.isFile()) return false;
  } catch {
    return false;
  }
  await stream(res, full, 200);
  return true;
}
