/**
 * Regenerates every consumer of the design tokens from `src/tokens.ts`.
 *
 * Two outputs:
 *   1. `dist/tokens.css`                     — importable by the React apps
 *   2. `apps/web/assets/css/main.css`        — the marketing site's `:root` block is
 *                                              rewritten in place between markers, so the
 *                                              site keeps working with no build step and
 *                                              no extra network request.
 *
 * Run: pnpm --filter @harmony/design-system build
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderRootBlock } from "../src/tokens.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

const BANNER = "/* Generated from packages/design-system/src/tokens.ts — do not edit by hand. */";
const START = "/* @tokens:start */";
const END = "/* @tokens:end */";

const rootBlock = renderRootBlock();

// 1. Standalone stylesheet for the React apps.
const distDir = resolve(here, "../dist");
mkdirSync(distDir, { recursive: true });
writeFileSync(resolve(distDir, "tokens.css"), `${BANNER}\n\n${rootBlock}\n`, "utf8");

// 2. Rewrite the marketing site's token block in place.
const webCss = resolve(repoRoot, "apps/web/assets/css/main.css");
const css = readFileSync(webCss, "utf8");

const startAt = css.indexOf(START);
const endAt = css.indexOf(END);
if (startAt === -1 || endAt === -1) {
  throw new Error(
    `Token markers not found in ${webCss}. Expected ${START} … ${END} around the :root block.`,
  );
}

const next =
  css.slice(0, startAt) +
  `${START}\n${BANNER}\n\n${rootBlock}\n${END}` +
  css.slice(endAt + END.length);

if (next !== css) {
  writeFileSync(webCss, next, "utf8");
  console.log("tokens: updated apps/web/assets/css/main.css");
} else {
  console.log("tokens: apps/web already in sync");
}

console.log("tokens: wrote packages/design-system/dist/tokens.css");
