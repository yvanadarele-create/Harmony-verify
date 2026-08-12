#!/usr/bin/env node
/**
 * Integrity check for the Brandora front end (apps/brandora).
 *
 * Runs with no browser and no server, so it works in CI. It catches the class of
 * breakage that a rename or a file move introduces — a dead asset reference, a
 * duplicate id, a page that lost its metadata — and three Brandora-specific
 * rules that matter more than any of those:
 *
 *   - No page may reference a secret environment variable (§29).
 *   - Every page must offer both the language switcher and the theme toggle,
 *     because §23 and §7 are promises about the whole application, not the
 *     landing page.
 *   - The generated data the pages fetch must actually exist, or the site loads
 *     to an empty catalogue and a spinner.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../apps/brandora");

const problems = [];
const pages = readdirSync(root).filter((file) => file.endsWith(".html"));

if (pages.length === 0) problems.push("no HTML pages found in apps/brandora");

/** Secrets that must never appear in anything served to a browser. */
const FORBIDDEN = [
  "ALIEXPRESS_APP_SECRET",
  "ALIEXPRESS_ACCESS_TOKEN",
  "ALIEXPRESS_REFRESH_TOKEN",
  "ANTHROPIC_API_KEY",
];

for (const page of pages) {
  const html = readFileSync(join(root, page), "utf8");
  const where = `apps/brandora/${page}`;

  if (!/<html[^>]+lang=/.test(html)) problems.push(`${where}: <html> missing lang`);
  if (!/<title>[^<]+<\/title>/.test(html)) problems.push(`${where}: missing <title>`);
  if (!/<meta\s+name="description"/.test(html)) problems.push(`${where}: missing meta description`);
  if (!/<meta\s+name="viewport"/.test(html)) problems.push(`${where}: missing viewport`);

  if (!/data-locale-switch/.test(html)) problems.push(`${where}: no language switcher (§23)`);
  if (!/data-theme-toggle/.test(html)) problems.push(`${where}: no dark/light toggle (§7)`);
  if (!/class="skip-link"/.test(html)) problems.push(`${where}: no skip link`);

  for (const secret of FORBIDDEN) {
    if (html.includes(secret)) problems.push(`${where}: references ${secret} — secrets never reach the browser (§29)`);
  }

  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  for (const duplicate of new Set(ids.filter((id, index) => ids.indexOf(id) !== index))) {
    problems.push(`${where}: duplicate id #${duplicate}`);
  }

  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const ref = match[1];
    if (/^(https?:|mailto:|tel:|data:|#|\/\/)/.test(ref)) continue;
    const [pathPart] = ref.split("#");
    if (!pathPart) continue;
    const target = join(root, pathPart.split("?")[0]);
    if (!existsSync(target)) problems.push(`${where}: broken reference to ${ref}`);
  }
}

/* --- Generated data the pages fetch at runtime ---------------------------- */

const GENERATED = [
  "data/catalog.json",
  "data/interview.json",
  "locales/en.json",
  "locales/fr.json",
  "locales/es.json",
  "assets/js/generated/color.js",
  "assets/js/generated/identity.js",
];

for (const file of GENERATED) {
  if (!existsSync(join(root, file))) {
    problems.push(`apps/brandora/${file} is missing — run the package builds that emit it`);
  }
}

/* --- Scripts must not carry secrets either -------------------------------- */

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|json)$/.test(entry.name)) out.push(full);
  }
  return out;
}

for (const file of walk(root)) {
  const contents = readFileSync(file, "utf8");
  for (const secret of FORBIDDEN) {
    if (contents.includes(secret)) problems.push(`${file}: references ${secret} (§29)`);
  }
}

/* --- Report --------------------------------------------------------------- */

if (problems.length > 0) {
  console.error(`\nBrandora front-end check failed with ${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error("");
  process.exit(1);
}

console.log(`Brandora front-end check passed — ${pages.length} pages, ${GENERATED.length} generated files.`);
