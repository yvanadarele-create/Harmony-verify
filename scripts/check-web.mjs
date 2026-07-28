#!/usr/bin/env node
/**
 * Integrity check for the static marketing site (apps/web).
 *
 * Runs without a browser or a server so it works in CI: verifies that every internal
 * link, anchor and asset reference actually resolves, that ids are unique, and that
 * required per-page metadata is present. Catches the class of breakage a file move or
 * a rename introduces.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "../apps/web");

/**
 * Assets the site references deliberately before the file exists. These degrade
 * gracefully in the page (see the founder monogram fallback), so a missing one is a
 * warning, not a build failure. Remove an entry once the real asset lands.
 */
const PENDING_ASSETS = new Map([
  ["assets/img/founder.jpg", "founder portrait — falls back to the AY monogram until supplied"],
]);

const pages = readdirSync(webRoot).filter((f) => f.endsWith(".html"));
const problems = [];
const warnings = [];

if (pages.length === 0) problems.push("no HTML pages found in apps/web");

for (const page of pages) {
  const file = join(webRoot, page);
  const html = readFileSync(file, "utf8");
  const where = `apps/web/${page}`;

  // Required metadata
  if (!/<html[^>]+lang=/.test(html)) problems.push(`${where}: <html> missing lang`);
  if (!/<title>[^<]+<\/title>/.test(html)) problems.push(`${where}: missing <title>`);
  if (!/<meta\s+name="description"/.test(html)) problems.push(`${where}: missing meta description`);
  if (!/<meta\s+name="viewport"/.test(html)) problems.push(`${where}: missing viewport`);

  // Unique ids
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  for (const d of new Set(dupes)) problems.push(`${where}: duplicate id #${d}`);

  // Every referenced local file must exist
  const refs = [
    ...html.matchAll(/(?:href|src)="([^"]+)"/g),
  ].map((m) => m[1]);

  for (const ref of refs) {
    if (/^(https?:|mailto:|tel:|data:|#|\/\/)/.test(ref)) continue;

    const [pathPart, frag] = ref.split("#");
    if (!pathPart) continue;
    const clean = pathPart.split("?")[0];

    // 404.html uses root-absolute paths; everything else is page-relative.
    const target = clean.startsWith("/")
      ? join(webRoot, clean.slice(1))
      : resolve(webRoot, clean);

    if (!existsSync(target)) {
      const rel = relative(webRoot, target).split("\\").join("/");
      if (PENDING_ASSETS.has(rel)) {
        warnings.push(`${where}: awaiting ${rel} — ${PENDING_ASSETS.get(rel)}`);
      } else {
        problems.push(`${where}: broken reference -> ${ref}`);
      }
      continue;
    }

    if (frag && target.endsWith(".html")) {
      const targetHtml = readFileSync(target, "utf8");
      if (!targetHtml.includes(`id="${frag}"`)) {
        problems.push(`${where}: missing anchor -> ${ref}`);
      }
    }
  }

  // Same-page anchors
  for (const m of html.matchAll(/href="#([^"]+)"/g)) {
    const frag = m[1];
    if (frag && !html.includes(`id="${frag}"`)) {
      problems.push(`${where}: dead same-page anchor -> #${frag}`);
    }
  }
}

// Token block must stay under design-system control
const cssPath = join(webRoot, "assets/css/main.css");
if (existsSync(cssPath)) {
  const css = readFileSync(cssPath, "utf8");
  if (!css.includes("/* @tokens:start */") || !css.includes("/* @tokens:end */")) {
    problems.push("apps/web/assets/css/main.css: design-system token markers missing");
  }
} else {
  problems.push("apps/web/assets/css/main.css: not found");
}

for (const w of warnings) console.warn(`  ! ${w}`);

if (problems.length) {
  console.error(`web integrity: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

console.log(
  `web integrity: OK — ${pages.length} pages, all references resolve` +
    (warnings.length ? ` (${warnings.length} pending asset(s))` : ""),
);
