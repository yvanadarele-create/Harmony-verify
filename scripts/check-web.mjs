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
const PENDING_ASSETS = new Map();

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

/* --- SEO invariants -------------------------------------------------------
 *
 * Search visibility is easy to lose silently: a page copied from another one
 * keeps its canonical, a JSON-LD block gets a trailing comma and is discarded
 * without warning, two pages end up with the same title. None of that shows up
 * in a browser, so it is asserted here.
 */
const titles = new Map();
const descriptions = new Map();
const canonicals = new Map();

for (const page of pages) {
  const html = readFileSync(join(webRoot, page), "utf8");
  const where = `apps/web/${page}`;
  const noindex = /<meta name="robots"[^>]*content="[^"]*noindex/.test(html);

  const title = /<title>([^<]+)<\/title>/.exec(html)?.[1]?.trim();
  const description = /<meta name="description" content="([^"]+)"/.exec(html)?.[1]?.trim();
  const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];

  if (title) {
    if (titles.has(title)) problems.push(`${where}: duplicate <title> shared with ${titles.get(title)}`);
    else titles.set(title, where);
    if (title.length > 65) warnings.push(`${where}: title is ${title.length} chars — Google truncates near 60`);
  }

  if (description) {
    if (descriptions.has(description)) {
      problems.push(`${where}: duplicate meta description shared with ${descriptions.get(description)}`);
    } else descriptions.set(description, where);
    if (description.length > 165) {
      warnings.push(`${where}: meta description is ${description.length} chars — truncated near 160`);
    }
  }

  // A noindex page (404) has nothing to be canonical about.
  if (!noindex) {
    if (!canonical) problems.push(`${where}: missing canonical`);
    else if (canonicals.has(canonical)) {
      problems.push(`${where}: canonical points at the same URL as ${canonicals.get(canonical)}`);
    } else canonicals.set(canonical, where);

    if (!/<meta property="og:title"/.test(html)) warnings.push(`${where}: no og:title — link previews will guess`);
  }

  // Invalid JSON-LD is dropped by Google without an error anyone sees.
  for (const [, body] of html.matchAll(
    /<script type="application\/ld\+json">((?:(?!<\/script>)[\s\S])*)<\/script>/g,
  )) {
    try {
      JSON.parse(body);
    } catch (error) {
      problems.push(`${where}: invalid JSON-LD — ${error.message}`);
    }
  }
}

// Search Console verifies the site at its root; losing this tag unverifies it.
const home = readFileSync(join(webRoot, "index.html"), "utf8");
if (!/<meta name="google-site-verification"/.test(home)) {
  problems.push("apps/web/index.html: google-site-verification tag is missing");
}

/* The sitemap and the canonicals must agree with what the server serves.
 *
 * Search Console rejects a sitemap whose URLs are on a different host than the
 * verified property, and reports every entry that redirects. With cleanUrls the
 * server serves /pricing and redirects /pricing.html, so a sitemap of .html URLs
 * is a sitemap of redirects. Neither fault is visible in a browser, and both
 * present as "your sitemap is wrong" with no indication of why. */
const sitemapPath = join(webRoot, "sitemap.xml");
const vercelPath = resolve(webRoot, "../../vercel.json");
const cleanUrls = existsSync(vercelPath)
  ? JSON.parse(readFileSync(vercelPath, "utf8")).cleanUrls === true
  : false;

if (!existsSync(sitemapPath)) {
  problems.push("apps/web/sitemap.xml: not found");
} else {
  const sitemap = readFileSync(sitemapPath, "utf8");
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  if (locs.length === 0) problems.push("apps/web/sitemap.xml: no <loc> entries");

  const hosts = new Set(locs.map((loc) => new URL(loc).host));
  if (hosts.size > 1) {
    problems.push(`apps/web/sitemap.xml: mixes hosts (${[...hosts].join(", ")})`);
  }

  const siteHost = [...hosts][0];

  for (const page of pages) {
    if (page === "404.html") continue;
    const expected = page === "index.html" ? "/" : cleanUrls ? `/${page.replace(/\.html$/, "")}` : `/${page}`;
    if (!locs.some((loc) => new URL(loc).pathname === expected)) {
      problems.push(`apps/web/sitemap.xml: ${page} is not listed (expected ${expected})`);
    }
  }

  if (cleanUrls) {
    for (const loc of locs) {
      if (loc.endsWith(".html")) {
        problems.push(`apps/web/sitemap.xml: ${loc} redirects under cleanUrls — drop the .html`);
      }
    }
  }

  // Canonicals must be on the same host as the sitemap, and in the same form.
  for (const page of pages) {
    if (page === "404.html") continue;
    const html = readFileSync(join(webRoot, page), "utf8");
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
    if (!canonical) continue;

    const url = new URL(canonical);
    if (siteHost && url.host !== siteHost) {
      problems.push(`apps/web/${page}: canonical host ${url.host} does not match the sitemap's ${siteHost}`);
    }
    if (cleanUrls && canonical.endsWith(".html")) {
      problems.push(`apps/web/${page}: canonical points at a URL that redirects — drop the .html`);
    }
    if (!locs.includes(canonical)) {
      problems.push(`apps/web/${page}: canonical ${canonical} is not in the sitemap`);
    }
  }

  // robots.txt must advertise the same sitemap URL.
  const robotsPath = join(webRoot, "robots.txt");
  if (existsSync(robotsPath)) {
    const declared = /^Sitemap:\s*(\S+)$/m.exec(readFileSync(robotsPath, "utf8"))?.[1];
    if (!declared) problems.push("apps/web/robots.txt: no Sitemap: line");
    else if (siteHost && new URL(declared).host !== siteHost) {
      problems.push(`apps/web/robots.txt: Sitemap host ${new URL(declared).host} does not match ${siteHost}`);
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
