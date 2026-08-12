/**
 * Emit the locale catalogues as JSON for the browser.
 *
 * The catalogues are authored in TypeScript so the compiler can enforce
 * completeness; the front end needs plain JSON. Generating one from the other at
 * build time means there is exactly one source of truth, and a translator can
 * never drift from the strings the application actually uses.
 *
 * Mirrors `@harmony/pricing-engine`'s emit step, which does the same thing for
 * prices.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CATALOGUES, LOCALES } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "..", "..", "apps", "brandora", "locales");

mkdirSync(outDir, { recursive: true });

for (const locale of LOCALES) {
  const file = join(outDir, `${locale}.json`);
  writeFileSync(file, `${JSON.stringify(CATALOGUES[locale], null, 2)}\n`, "utf8");
  process.stdout.write(`locales: wrote ${file}\n`);
}
