#!/usr/bin/env node
/* Generate the French and Spanish sites from the English one.
 *
 * The English pages in apps/web are the source of truth and are never written
 * to. Each run deletes apps/web/fr and apps/web/es and rebuilds them, so a
 * localized page cannot drift from its English original: change the English
 * copy and the localized copy either follows or shows up as a missing key.
 *
 * Why generated pages rather than swapping text in the browser:
 *
 *   - A crawler sees real French. Runtime translation ships an English document
 *     and rewrites it after paint, which is what search engines index and what
 *     the reader sees for a frame.
 *   - <html lang>, <title> and the meta description are actually French, not
 *     English elements with French text pushed into them later.
 *   - No flash of the wrong language.
 *
 * Missing keys fall back to English rather than rendering a key or "undefined",
 * and every one of them is reported at the end of the run.
 */
import { readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync, existsSync, cpSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, serialize, walk, inner, setInner, attr, setAttr } from "./dom.mjs";
import { extract, translatable } from "./extract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "../../apps/web");
const i18nRoot = join(webRoot, "i18n");

export const LANGS = [
  { code: "en", label: "English", dir: "" },
  { code: "fr", label: "Français", dir: "fr" },
  { code: "es", label: "Español", dir: "es" },
];
const TARGETS = LANGS.filter((l) => l.dir);

const SITE = "https://harmonyverify.org";

const pages = readdirSync(webRoot).filter((f) => f.endsWith(".html")).sort();

function dict(code) {
  const file = join(i18nRoot, `${code}.json`);
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Language-prefix an absolute site URL, leaving assets and entity ids alone. */
function localizeAbsolute(url, dir) {
  if (!url.startsWith(SITE)) return url;
  const rest = url.slice(SITE.length);
  // Shared assets stay shared, and the ids identifying one organisation across
  // all three sites must not be prefixed — doing so would split a single entity
  // in structured data into three.
  if (rest.startsWith("/assets/") || rest.startsWith("/#") || rest.startsWith("/favicon")) return url;
  if (rest === "" || rest === "/") return `${SITE}/${dir}/`;
  return `${SITE}/${dir}${rest}`;
}

/** Rewrite a page-relative reference so it still resolves from inside /<dir>/. */
function localizeRef(value) {
  if (/^(https?:|mailto:|tel:|data:|#|\/\/)/.test(value)) return null;
  if (value.startsWith("/")) return null; // handled separately
  if (/^(assets\/|favicon\.ico|site\.webmanifest)/.test(value)) return "../" + value;
  return null;
}

function translateJsonLd(body, table) {
  // Human-readable values only; @id, @type and URLs are handled elsewhere.
  const FIELDS = ["name", "description", "text", "slogan", "caption", "jobTitle", "serviceType", "alternateName"];
  let out = body;
  for (const field of FIELDS) {
    const re = new RegExp(`("${field}"\\s*:\\s*")((?:[^"\\\\]|\\\\.)*)(")`, "g");
    out = out.replace(re, (m, a, value, c) => {
      const decoded = value.replace(/\\"/g, '"').replace(/\\n/g, "\n");
      const hit = table.get(decoded.trim());
      if (!hit) return m;
      return a + hit.replace(/"/g, '\\"') + c;
    });
  }
  return out;
}

function buildLanguage(lang, report) {
  const table = new Map(Object.entries(dict(lang.code)));
  const outDir = join(webRoot, lang.dir);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const missing = new Map();
  let translated = 0;
  let total = 0;

  for (const page of pages) {
    const html = readFileSync(join(webRoot, page), "utf8");
    const doc = parse(html);

    const use = (text) => {
      const key = text.trim();
      if (!translatable(key)) return null;
      total++;
      const hit = table.get(key);
      if (hit) {
        translated++;
        return hit;
      }
      if (!missing.has(key)) missing.set(key, new Set());
      missing.get(key).add(page);
      return null; // English stays, which is the fallback
    };

    // <html lang="…">
    walk(doc, (el) => {
      if (el.name === "html") setAttr(el, "lang", lang.code);
    });

    // <title>
    walk(doc, (el) => {
      if (el.name !== "title") return;
      const next = use(inner(el));
      if (next) setInner(el, next);
    });

    // Head metadata and reader-visible attributes.
    walk(doc, (el) => {
      if (el.name === "meta") {
        const name = attr(el, "name") || attr(el, "property");
        if (name && /^(description|og:title|og:description|twitter:title|twitter:description)$/.test(name)) {
          const next = use(attr(el, "content") || "");
          if (next) setAttr(el, "content", next);
        }
        if (name === "og:locale") setAttr(el, "content", lang.code === "fr" ? "fr_FR" : "es_ES");
      }
      for (const a of ["alt", "placeholder", "aria-label", "title"]) {
        const value = attr(el, a);
        if (!value) continue;
        const next = use(value);
        if (next) setAttr(el, a, next);
      }
    });

    // Prose, block by block.
    translateBlocks(doc, use);

    // References out of the language directory.
    walk(doc, (el) => {
      // og:url carries a URL in content=, not href=.
      if (el.name === "meta") {
        const prop = attr(el, "property") || attr(el, "name");
        if (prop && /^(og:url|twitter:url)$/.test(prop)) {
          const value = attr(el, "content");
          if (value) setAttr(el, "content", localizeAbsolute(value, lang.dir));
        }
      }
      for (const a of ["href", "src", "poster"]) {
        const value = attr(el, a);
        if (!value) continue;
        if (value.startsWith(SITE)) {
          setAttr(el, a, localizeAbsolute(value, lang.dir));
          continue;
        }
        if (value.startsWith("/") && value.endsWith(".html")) {
          setAttr(el, a, `/${lang.dir}${value}`);
          continue;
        }
        const rel = localizeRef(value);
        if (rel) setAttr(el, a, rel);
      }
      const srcset = attr(el, "srcset");
      if (srcset) {
        setAttr(el, "srcset", srcset.replace(/(^|,\s*)assets\//g, "$1../assets/"));
      }
    });

    // JSON-LD: prefix page URLs, translate human-readable values.
    walk(doc, (el) => {
      if (el.name !== "script") return;
      if (!/application\/ld\+json/.test(el.raw)) return;
      const body = inner(el);
      let next = body.replace(new RegExp(SITE + "(/[^\"\\s]*)?", "g"), (m) => localizeAbsolute(m, lang.dir));
      next = translateJsonLd(next, table);
      el.children = [{ type: "text", value: next }];
    });

    let out = serialize(doc);
    out = withAlternates(out, page, lang.code);
    writeFileSync(join(outDir, page), out, "utf8");
  }

  /* A key that matches nothing is a typo in the dictionary, and it fails
     silently — the page just stays English. Cheaper to be told. */
  const used = new Set();
  for (const page of pages) {
    const html = readFileSync(join(webRoot, page), "utf8");
    for (const unit of extract(html)) used.add(unit.text);
  }
  const orphans = [...table.keys()].filter((k) => !used.has(k));

  report.push({
    code: lang.code,
    total,
    translated,
    missing,
    orphans,
    coverage: total ? Math.round((translated / total) * 1000) / 10 : 0,
  });
}

/** Translate prose blocks in place. Mirrors extract.mjs's segmentation. */
function translateBlocks(doc, use) {
  const CONTAINER = new Set([
    "html", "head", "body", "header", "nav", "main", "section", "footer", "div",
    "article", "aside", "ul", "ol", "dl", "table", "thead", "tbody", "tfoot",
    "tr", "figure", "form", "fieldset", "select", "picture", "video", "details",
    "script", "style", "template",
  ]);
  const LEAF = new Set([
    "p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "dt", "dd", "td", "th",
    "caption", "figcaption", "legend", "label", "button", "option", "summary",
    "blockquote", "a", "span", "b", "strong", "em", "small",
  ]);
  const INLINE = new Set(["span", "b", "strong", "em", "small", "a"]);
  const BLOCKISH = new Set([...CONTAINER, ...LEAF].filter((t) => !INLINE.has(t)));

  const hasBlock = (node) => {
    let found = false;
    walk(node, (el) => {
      if (BLOCKISH.has(el.name)) found = true;
    });
    return found;
  };

  const descend = (node) => {
    for (const child of node.children || []) {
      if (child.type === "text") {
        if (node.name === "script" || node.name === "style") continue;
        const next = use(child.value);
        if (next) {
          const lead = /^\s*/.exec(child.value)[0];
          const tail = /\s*$/.exec(child.value)[0];
          child.value = lead + next + tail;
        }
        continue;
      }
      if (child.type !== "element") continue;
      if (child.name === "script" || child.name === "style" || child.name === "title") continue;
      if (CONTAINER.has(child.name) || hasBlock(child)) {
        descend(child);
        continue;
      }
      if (LEAF.has(child.name)) {
        const next = use(inner(child));
        if (next) setInner(child, next);
        continue;
      }
      descend(child);
    }
  };
  descend(doc);
}

/** Insert hreflang alternates just after the canonical link. */
function withAlternates(html, page, code) {
  const slug = page === "index.html" ? "" : page.replace(/\.html$/, "");
  const href = (lang) => `${SITE}${lang.dir ? "/" + lang.dir : ""}/${slug}`;
  const links = [
    ...LANGS.map((l) => `<link rel="alternate" hreflang="${l.code}" href="${href(l)}">`),
    `<link rel="alternate" hreflang="x-default" href="${href(LANGS[0])}">`,
  ].join("\n");

  if (/<link rel="alternate" hreflang=/.test(html)) return html;
  if (/<link rel="canonical"[^>]*>/.test(html)) {
    return html.replace(/(<link rel="canonical"[^>]*>)/, `$1\n${links}`);
  }
  return html.replace(/(<meta name="robots"[^>]*>)/, `$1\n${links}`);
}

/** English pages get the same alternates, and only that. */
function annotateEnglish() {
  let touched = 0;
  for (const page of pages) {
    const file = join(webRoot, page);
    const html = readFileSync(file, "utf8");
    const next = withAlternates(html, page, "en");
    if (next !== html) {
      writeFileSync(file, next, "utf8");
      touched++;
    }
  }
  return touched;
}

const report = [];
for (const lang of TARGETS) buildLanguage(lang, report);
const english = annotateEnglish();

const lines = [`i18n: built ${TARGETS.map((l) => l.dir).join(", ")} from ${pages.length} English pages`];
if (english) lines.push(`  hreflang added to ${english} English page(s)`);
for (const r of report) {
  lines.push(`  ${r.code}: ${r.translated}/${r.total} strings (${r.coverage}%), ${r.missing.size} key(s) missing`);
  if (r.orphans.length) {
    lines.push(`  ${r.code}: ${r.orphans.length} dictionary key(s) match nothing on the site:`);
    for (const key of r.orphans.slice(0, 8)) lines.push(`      ${JSON.stringify(key.slice(0, 90))}`);
    if (r.orphans.length > 8) lines.push(`      … and ${r.orphans.length - 8} more`);
  }
}
console.log(lines.join("\n"));

if (process.env.I18N_REPORT) {
  for (const r of report) {
    const out = join(i18nRoot, `missing.${r.code}.json`);
    const rows = [...r.missing.entries()].map(([text, pageSet]) => ({ text, pages: [...pageSet].sort() }));
    writeFileSync(out, JSON.stringify(rows, null, 2) + "\n", "utf8");
    console.log(`  wrote ${rows.length} missing key(s) to i18n/missing.${r.code}.json`);
  }
}
