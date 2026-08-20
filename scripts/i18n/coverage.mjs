#!/usr/bin/env node
/* Per-page translation coverage, so "how far along is this" has a number. */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extract } from "./extract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "../../apps/web");
const codes = ["fr", "es"];
const dicts = Object.fromEntries(
  codes.map((c) => {
    const p = join(webRoot, "i18n", `${c}.json`);
    return [c, existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {}];
  }),
);

const pages = readdirSync(webRoot).filter((f) => f.endsWith(".html")).sort();
const rows = [];
for (const page of pages) {
  const units = extract(readFileSync(join(webRoot, page), "utf8"));
  const row = { page, total: units.length };
  for (const c of codes) {
    row[c] = units.filter((u) => u.text in dicts[c]).length;
  }
  rows.push(row);
}

const pad = (s, n) => String(s).padEnd(n);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 100);
console.log(pad("page", 28) + pad("strings", 9) + pad("fr", 12) + "es");
for (const r of rows) {
  console.log(
    pad(r.page, 28) +
      pad(r.total, 9) +
      pad(`${pct(r.fr, r.total)}%`, 12) +
      `${pct(r.es, r.total)}%`,
  );
}
const tot = rows.reduce((a, r) => a + r.total, 0);
for (const c of codes) {
  const done = rows.reduce((a, r) => a + r[c], 0);
  console.log(`${c}: ${done}/${tot} unique strings (${pct(done, tot)}%)`);
}
