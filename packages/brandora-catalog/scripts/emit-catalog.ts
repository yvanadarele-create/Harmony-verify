/**
 * Emit the catalogue as JSON for the browser.
 *
 * Same reasoning as the locale emitter: the catalogue is authored in TypeScript
 * so the compiler checks it, and the static front end reads the generated JSON.
 * One source of truth, and a product that fails typecheck never reaches a page.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CATALOG } from "../dist/seed.js";
import { categories } from "../dist/query.js";
import { STARTER_PACKAGES } from "../dist/package.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "..", "..", "apps", "brandora", "data");

mkdirSync(outDir, { recursive: true });

// No build timestamp: the output is a pure function of the source, and a clock
// reading in it would make every build a diff and every diff unreviewable.
const payload = {
  generatedFrom: "packages/brandora-catalog/scripts/emit-catalog.ts",
  categories: categories(),
  starterPackages: STARTER_PACKAGES,
  products: CATALOG,
};

const file = join(outDir, "catalog.json");
writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
process.stdout.write(`catalog: wrote ${CATALOG.length} products to ${file}\n`);
