#!/usr/bin/env node
/* Print the untranslated strings for one page, ready to paste into a dictionary.
 *   node scripts/i18n/todo.mjs fr index.html
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extract } from "./extract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "../../apps/web");
const [code, page] = process.argv.slice(2);
if (!code || !page) {
  console.error("usage: todo.mjs <fr|es> <page.html>");
  process.exit(1);
}
const dictPath = join(webRoot, "i18n", `${code}.json`);
const table = existsSync(dictPath) ? JSON.parse(readFileSync(dictPath, "utf8")) : {};
const units = extract(readFileSync(join(webRoot, page), "utf8"));
const missing = units.filter((u) => !(u.text in table));
console.log(JSON.stringify(missing.map((u) => u.text), null, 2));
console.error(`${page}: ${missing.length} of ${units.length} still English`);
