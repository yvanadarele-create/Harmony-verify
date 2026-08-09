#!/usr/bin/env node
/**
 * Rewrites every absolute URL the site publishes about itself, from one source.
 *
 * Two things kept going wrong by hand, and both are invisible in a browser:
 *
 *   1. **Host drift.** The canonical tags, the Open Graph URLs, the JSON-LD and
 *      the sitemap each carry a full URL. Change the domain and you have to
 *      change all four consistently. Miss one and Search Console rejects the
 *      sitemap with "URLs not on this site" — which reads like a broken file
 *      rather than a one-word mismatch.
 *
 *   2. **Extension drift.** `vercel.json` sets `cleanUrls: true`, so the server
 *      serves `/pricing` and redirects `/pricing.html` to it. A sitemap full of
 *      `.html` URLs is therefore a sitemap of redirects, and a canonical
 *      pointing at `.html` contradicts the URL Google actually fetched. Both are
 *      reported as errors and neither is visible on the page.
 *
 * So the base URL comes from the environment and the extension is derived from
 * the deployment config, and this script writes both into every file that
 * declares them.
 *
 *   SITE_URL=https://harmonyverify.online node scripts/site-urls.mjs
 *
 * Run with no arguments it uses, in order: SITE_URL, PUBLIC_BASE_URL, Vercel's
 * production domain, then the committed default. Runs as part of `build:web`,
 * so a Vercel deploy publishes URLs for the domain it is actually served from.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const webRoot = join(repoRoot, "apps/web");

const DEFAULT_SITE = "https://harmonyverify.org";

/* --- Where the base URL comes from ---------------------------------------- */

function resolveBaseUrl() {
  const explicit = process.env.SITE_URL || process.env.PUBLIC_BASE_URL;
  if (explicit) return normalise(explicit);

  // Vercel exposes the production domain to the build. Preferred over VERCEL_URL,
  // which is the per-deployment hostname and would put a throwaway preview
  // domain into the canonical tags of a production build.
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return normalise(vercel);

  return DEFAULT_SITE;
}

function normalise(value) {
  const withScheme = /^https?:\/\//.test(value) ? value : `https://${value}`;
  return withScheme.replace(/\/+$/, "");
}

/* --- Path form ------------------------------------------------------------ */

const vercelConfig = join(repoRoot, "vercel.json");
const cleanUrls = existsSync(vercelConfig)
  ? JSON.parse(readFileSync(vercelConfig, "utf8")).cleanUrls === true
  : false;

/** `pricing.html` → `/pricing` under cleanUrls, `/pricing.html` otherwise. */
function publicPath(page) {
  if (page === "index.html") return "/";
  return cleanUrls ? `/${page.replace(/\.html$/, "")}` : `/${page}`;
}

const canonicalFor = (base, page) => `${base}${publicPath(page)}`;

/* --- Rewrite -------------------------------------------------------------- */

const base = resolveBaseUrl();
const host = new URL(base).host;

const pages = readdirSync(webRoot).filter((f) => f.endsWith(".html"));
const indexable = pages.filter((p) => p !== "404.html");
const changed = [];

/**
 * Any absolute URL on a Harmony host, whatever host it currently names.
 * Matching by shape rather than by the previous value means this repairs a file
 * that was edited by hand to something wrong, not only one it wrote itself.
 */
const ABSOLUTE = /https:\/\/(?:www\.)?harmonyverify\.[a-z.]+((?:\/[^"'\s)]*)?)/g;

function rewriteAbsolute(text) {
  return text.replace(ABSOLUTE, (_match, path) => {
    if (!path || path === "/") return `${base}/`;
    // Asset paths keep their extension; only page URLs are cleaned.
    const isPage = /\.html$/.test(path);
    const cleaned = isPage && cleanUrls ? path.replace(/\.html$/, "") : path;
    return `${base}${cleaned === "/index" ? "/" : cleaned}`;
  });
}

for (const page of pages) {
  const file = join(webRoot, page);
  const before = readFileSync(file, "utf8");
  let html = rewriteAbsolute(before);

  // The canonical must name this page exactly, whatever it said before.
  if (page !== "404.html") {
    html = html.replace(
      /<link rel="canonical" href="[^"]*">/,
      `<link rel="canonical" href="${canonicalFor(base, page)}">`,
    );
    html = html.replace(
      /<meta property="og:url" content="[^"]*">/,
      `<meta property="og:url" content="${canonicalFor(base, page)}">`,
    );
  }

  if (html !== before) {
    writeFileSync(file, html, "utf8");
    changed.push(page);
  }
}

/* --- Sitemap -------------------------------------------------------------- */

const PRIORITY = {
  "index.html": ["1.0", "monthly"],
  "platform.html": ["0.9", "monthly"],
  "solutions.html": ["0.9", "monthly"],
  "pricing.html": ["0.9", "monthly"],
  "request-verification.html": ["0.9", "monthly"],
  "experts.html": ["0.8", "monthly"],
  "partners.html": ["0.8", "monthly"],
  "investors.html": ["0.8", "monthly"],
  "founder.html": ["0.8", "monthly"],
  "trust.html": ["0.8", "monthly"],
  "contact.html": ["0.8", "yearly"],
  "company.html": ["0.7", "monthly"],
  "privacy.html": ["0.4", "yearly"],
  "terms.html": ["0.4", "yearly"],
};

const order = Object.keys(PRIORITY);
const sorted = [
  ...order.filter((p) => indexable.includes(p)),
  ...indexable.filter((p) => !order.includes(p)),
];

const lastmod = new Date().toISOString().slice(0, 10);

const sitemap =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  sorted
    .map((page) => {
      const [priority, changefreq] = PRIORITY[page] ?? ["0.5", "monthly"];
      return (
        `  <url>\n` +
        `    <loc>${canonicalFor(base, page)}</loc>\n` +
        `    <lastmod>${lastmod}</lastmod>\n` +
        `    <changefreq>${changefreq}</changefreq>\n` +
        `    <priority>${priority}</priority>\n` +
        `  </url>\n`
      );
    })
    .join("") +
  `</urlset>\n`;

const sitemapPath = join(webRoot, "sitemap.xml");
if (readFileSync(sitemapPath, "utf8") !== sitemap) {
  writeFileSync(sitemapPath, sitemap, "utf8");
  changed.push("sitemap.xml");
}

/* --- Contact addresses ------------------------------------------------------
 *
 * Deliberately opt-in and separate from the site host. Mail is often hosted on a
 * different domain than the website, and rewriting hello@ to a domain with no
 * mailbox behind it does not fail loudly — it silently loses enquiries, which is
 * the most expensive kind of quiet breakage a marketing site has.
 *
 *   CONTACT_DOMAIN=harmonyverify.org node scripts/site-urls.mjs
 */
const contactDomain = process.env.CONTACT_DOMAIN;
if (contactDomain) {
  const clean = contactDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  // The TLD is matched label by label rather than as [a-z.]+, which would
  // swallow the full stop that ends a sentence and silently delete it.
  const MAILBOX = /\b([a-z][\w.+-]*)@harmonyverify(?:\.[a-z]+)+/g;
  let rewritten = 0;

  /* Addresses live in the scripts too — the contact form's fallback mailto, the
     human-chat inbox and the assistant's answer to "how do I reach someone".
     Rewriting only the HTML would leave those three pointing at the old domain,
     which is exactly the silent breakage this block exists to avoid. */
  const carriers = [
    ...pages,
    ...readdirSync(join(webRoot, "assets", "js"))
      .filter((f) => f.endsWith(".js"))
      .map((f) => join("assets", "js", f)),
  ];

  for (const page of carriers) {
    const file = join(webRoot, page);
    const before = readFileSync(file, "utf8");
    const after = before.replace(MAILBOX, (_m, mailbox) => `${mailbox}@${clean}`);
    if (after !== before) {
      writeFileSync(file, after, "utf8");
      rewritten += 1;
    }
  }

  if (rewritten) {
    changed.push(`${rewritten} page(s) of contact addresses`);
    console.log(`contact addresses: rewritten to @${clean}`);
  }
}

/* --- robots.txt ----------------------------------------------------------- */

const robotsPath = join(webRoot, "robots.txt");
const robotsBefore = readFileSync(robotsPath, "utf8");
const robots = robotsBefore.replace(/^Sitemap: .*$/m, `Sitemap: ${base}/sitemap.xml`);
if (robots !== robotsBefore) {
  writeFileSync(robotsPath, robots, "utf8");
  changed.push("robots.txt");
}

console.log(
  `site urls: ${host}${cleanUrls ? " (clean urls)" : ""} — ` +
    `${indexable.length} pages in sitemap` +
    (changed.length ? `, updated ${changed.length} file(s)` : ", already current"),
);
