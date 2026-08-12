/**
 * Ship the identity logic to the browser without a bundler and without a copy.
 *
 * The brand builder needs to show a palette the moment the founder finishes the
 * interview — waiting on a round trip to redraw five swatches is the wrong
 * feeling for the most exciting screen in the product. The obvious way to get
 * that is to reimplement `derivePalette` in the page, and the obvious way is
 * wrong: two implementations of the same rule drift, and the drift shows up as a
 * preview that does not match the brand kit the founder downloads.
 *
 * `identity.ts` imports only `./color.js` at runtime — everything else it uses
 * from `@brandora/shared` is a type, which the compiler erases. `color.ts`
 * imports nothing at all. So both compile to standalone ES modules a browser can
 * load directly, and copying the *compiled output* means the page and the server
 * run the same code rather than the same idea.
 *
 * This is enforced, not assumed: the copy fails if either file grows an import
 * the browser could not resolve.
 */

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { INTERVIEW_QUESTIONS } from "../dist/interview.js";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "..", "dist");
const appDir = join(here, "..", "..", "..", "apps", "brandora");
const outDir = join(appDir, "assets", "js", "generated");

mkdirSync(outDir, { recursive: true });
mkdirSync(join(appDir, "data"), { recursive: true });

const MODULES = ["color.js", "identity.js"];

/** Only relative specifiers survive in a browser without an import map. */
const BARE_IMPORT = /^\s*(?:import|export)\s[^'"]*from\s+["'](?!\.)/gm;

for (const file of MODULES) {
  const source = join(distDir, file);
  const contents = readFileSync(source, "utf8");

  const offending = contents.match(BARE_IMPORT);
  if (offending) {
    throw new Error(
      `${file} now imports a bare specifier (${offending.join(", ").trim()}), which a browser cannot resolve. ` +
        "Keep runtime imports in identity.ts relative, or move the dependency behind a type-only import.",
    );
  }

  copyFileSync(source, join(outDir, file));
  process.stdout.write(`identity: copied ${file} to ${outDir}\n`);
}

/**
 * The interview questions are *data*, so they travel as JSON rather than as a
 * copied module. Emitting them keeps the wording, the help prompts and the
 * options in one place — the compiler-checked source — instead of duplicated
 * into markup where a question could be improved on one surface and not the
 * other.
 */
const questionsFile = join(appDir, "data", "interview.json");
writeFileSync(questionsFile, `${JSON.stringify(INTERVIEW_QUESTIONS, null, 2)}\n`, "utf8");
process.stdout.write(`identity: wrote ${INTERVIEW_QUESTIONS.length} questions to ${questionsFile}\n`);
