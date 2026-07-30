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

/* --- Consent invariants ---------------------------------------------------
 *
 * The rule the site has to keep is that nothing but strictly necessary storage
 * runs before a visitor chooses. That is easy to hold today and easy to break in
 * six months by pasting a vendor snippet into one page, so it is checked here
 * rather than trusted.
 *
 * Three things are asserted per page: the consent script is present, it is not
 * deferred behind the scripts it is supposed to gate, and every third-party or
 * tracking script is written as an inert placeholder that consent.js promotes.
 */
const THIRD_PARTY = /<script\b[^>]*\bsrc="https?:\/\/[^"]+"[^>]*>/gi;
// Bounded to a single element, so prose elsewhere on the page cannot trip it.
const SCRIPT_BLOCK = /<script\b([^>]*)>((?:(?!<\/script>)[\s\S])*)<\/script>/gi;
const TRACKER_CALL = /\b(gtag\s*\(|dataLayer\s*\.|dataLayer\s*=|fbq\s*\(|_paq\s*\.|analytics\.track\s*\(|plausible\s*\()/;

for (const page of pages) {
  const html = readFileSync(join(webRoot, page), "utf8");
  const where = `apps/web/${page}`;

  if (!/<script[^>]+consent\.js/.test(html)) {
    problems.push(`${where}: consent.js is not loaded — cookies could fire before a choice is made`);
  } else if (/<script[^>]+consent\.js[^>]*\bdefer\b/.test(html)) {
    problems.push(
      `${where}: consent.js is deferred — it must run before the scripts it gates, so it cannot carry defer`,
    );
  }

  if (!/data-consent-open/.test(html)) {
    problems.push(`${where}: no "Cookie preferences" control — consent must be withdrawable from every page`);
  }

  for (const tag of html.match(THIRD_PARTY) ?? []) {
    if (!/type="text\/plain"/.test(tag) || !/data-consent=/.test(tag)) {
      problems.push(
        `${where}: third-party script loads unconditionally -> ${tag.slice(0, 90)}… ` +
          `(use type="text/plain" data-consent="analytics" data-src="…")`,
      );
    }
  }

  for (const [, attrs, body] of html.matchAll(SCRIPT_BLOCK)) {
    if (/type="text\/plain"/.test(attrs)) continue;
    if (TRACKER_CALL.test(body)) {
      problems.push(`${where}: inline tracking snippet is not gated behind consent`);
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
