#!/usr/bin/env node
/**
 * Integrity check for the storefront (apps/delices).
 *
 * Runs without a browser or a server so it works in CI: every internal link, script
 * and stylesheet must resolve, ids must be unique, pages must carry the metadata a
 * search engine and a screen reader need, and every element the page scripts reach
 * for by data-attribute must actually exist in the markup that ships.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../apps/delices");

const problems = [];
const pages = readdirSync(root).filter((file) => file.endsWith(".html"));
if (pages.length === 0) problems.push("no HTML pages found in apps/delices");

/** Hooks each page script needs. A rename that breaks one of these is a silent bug. */
const REQUIRED_HOOKS = {
  "index.html": ["data-catalogue", "data-testimonials", "data-gallery-grid"],
  "gateaux.html": ['data-category="gateaux"'],
  "pizzas.html": ['data-category="pizzas"'],
  "quiches.html": ['data-category="quiches"'],
  "produit.html": ["data-product-page", "data-options", "data-add", "data-quantity"],
  "sur-mesure.html": [
    "data-brief-form",
    "data-occasions",
    "data-shapes",
    "data-flavours",
    "data-fillings",
    "data-decorations",
    "data-inspiration",
  ],
  "commande.html": ["data-order-form", "data-basket", "data-delivery-fields"],
  "rendez-vous.html": ["data-appointment-form"],
  "suivi.html": ["data-track-form", "data-track-result"],
  "merci.html": ["data-reference"],
};

const allPaths = new Set(["/"]);
for (const page of pages) allPaths.add("/" + page.replace(/\.html$/, ""));
allPaths.add("/admin/");

function checkFile(file, where, { isAdmin = false } = {}) {
  const html = readFileSync(file, "utf8");

  if (!/<html[^>]+lang="fr"/.test(html)) problems.push(`${where}: <html> missing lang="fr"`);
  if (!/<title>[^<]+<\/title>/.test(html)) problems.push(`${where}: missing <title>`);
  if (!/<meta\s+name="description"/.test(html)) problems.push(`${where}: missing meta description`);
  if (!/<meta\s+name="viewport"/.test(html)) problems.push(`${where}: missing viewport`);
  if (!isAdmin && !/<a class="skip-link"/.test(html)) problems.push(`${where}: missing skip link`);
  if (!isAdmin && !/<main id="main">/.test(html)) problems.push(`${where}: missing <main id="main">`);

  const headings = html.match(/<h1[\s>]/g) ?? [];
  if (headings.length !== 1) {
    problems.push(`${where}: expected exactly one <h1>, found ${headings.length}`);
  }

  // Unique ids
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) problems.push(`${where}: duplicate id "${id}"`);
    seen.add(id);
  }

  // Every label points at a field that exists
  for (const match of html.matchAll(/<label[^>]+for="([^"]+)"/g)) {
    if (!seen.has(match[1])) problems.push(`${where}: <label for="${match[1]}"> has no field`);
  }

  // Internal links resolve
  for (const match of html.matchAll(/href="(\/[^"#?]*)(?:[?#][^"]*)?"/g)) {
    const target = match[1];
    if (target.startsWith("/assets/") || target.startsWith("/uploads/")) {
      const asset = join(root, target);
      if (!existsSync(asset)) problems.push(`${where}: missing asset ${target}`);
      continue;
    }
    if (!allPaths.has(target) && !allPaths.has(target.replace(/\/$/, ""))) {
      problems.push(`${where}: link to unknown page ${target}`);
    }
  }

  // Scripts and stylesheets exist
  for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) {
    if (!existsSync(join(root, match[1]))) problems.push(`${where}: missing file ${match[1]}`);
  }

  // Images carry alt text
  for (const match of html.matchAll(/<img\s([^>]*)>/g)) {
    if (!/\salt=/.test(match[1])) problems.push(`${where}: <img> without alt`);
  }

  return html;
}

for (const page of pages) {
  const html = checkFile(join(root, page), `apps/delices/${page}`);
  for (const hook of REQUIRED_HOOKS[page] ?? []) {
    if (!html.includes(hook)) {
      problems.push(`apps/delices/${page}: missing hook ${hook} required by its script`);
    }
  }
}

const adminPage = join(root, "admin/index.html");
if (!existsSync(adminPage)) problems.push("apps/delices/admin/index.html is missing");
else {
  const html = checkFile(adminPage, "apps/delices/admin/index.html", { isAdmin: true });
  if (!/name="robots"[^>]*noindex/.test(html)) {
    problems.push("apps/delices/admin/index.html: the admin must not be indexable");
  }
}

// The site must never ship a hard-coded phone number or address: those are settings.
for (const page of pages) {
  const html = readFileSync(join(root, page), "utf8");
  const body = html.replace(/<script[\s\S]*?<\/script>/g, "");
  if (/\+\d{2}[\d\s.-]{8,}/.test(body)) {
    problems.push(`apps/delices/${page}: hard-coded phone number — use data-setting instead`);
  }
}

if (!existsSync(join(root, "robots.txt"))) problems.push("apps/delices/robots.txt is missing");
else if (!readFileSync(join(root, "robots.txt"), "utf8").includes("Disallow: /admin/")) {
  problems.push("apps/delices/robots.txt should keep crawlers out of /admin/");
}

if (problems.length > 0) {
  console.error(`✗ ${problems.length} problem(s) in apps/delices:\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`✓ apps/delices: ${pages.length} pages + admin console check out.`);
