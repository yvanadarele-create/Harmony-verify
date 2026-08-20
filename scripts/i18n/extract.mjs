/* Pull every reader-visible string out of the English site.
 *
 * A unit is a whole block of prose with its inline markup intact, so a
 * translator receives "the <b>verification layer</b> between your model and the
 * clinician using it" rather than three fragments they cannot reorder. French
 * and Spanish both move words around inline tags; fragments make that
 * impossible.
 *
 * The English pages stay the source of truth. Nothing here writes to them.
 */
import { parse, walk, inner, attr } from "./dom.mjs";

/* Structure. Never a unit; always recursed into. */
const CONTAINER = new Set([
  "html", "head", "body", "header", "nav", "main", "section", "footer", "div",
  "article", "aside", "ul", "ol", "dl", "table", "thead", "tbody", "tfoot",
  "tr", "figure", "form", "fieldset", "select", "picture", "video", "details",
  "script", "style", "template",
]);

/* Prose. A unit when it holds no other block. */
const LEAF = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "dt", "dd", "td", "th",
  "caption", "figcaption", "legend", "label", "button", "option", "summary",
  "blockquote", "a", "span", "b", "strong", "em", "small", "title",
]);

const INLINE = new Set(["span", "b", "strong", "em", "small", "a"]);
const BLOCKISH = new Set([...CONTAINER, ...LEAF].filter((t) => !INLINE.has(t)));

/** Attributes that a reader sees. */
const ATTRS = ["alt", "placeholder", "aria-label", "title"];

/** Never translated: identifiers, not language. */
const KEEP = [
  /^[\s\d.,:/+%$EUR-]*$/,
  /^REC-[\w-]+$/i,
  /^SUP-[\w-]+$/i,
  /^Harmony Verify$/,
  /^Harmony$/,
  /^[\w.+-]+@[\w.-]+$/,
  /^https?:\/\//,
];

export function translatable(text) {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return false;
  // Letters must be in the prose, not in the tag names. Without stripping
  // markup first, "<span></span><span></span>" reads as translatable because
  // "span" is a word.
  const prose = t.replace(/<[^>]*>/g, " ").replace(/&[a-z]+;|&#\d+;/gi, " ").trim();
  if (!/\p{Letter}/u.test(prose)) return false;
  return !KEEP.some((re) => re.test(prose)) && !KEEP.some((re) => re.test(t));
}

function hasBlock(node) {
  let found = false;
  walk(node, (el) => {
    if (BLOCKISH.has(el.name)) found = true;
  });
  return found;
}

/**
 * Segment one page. Returns [{ text, kind, attr?, meta? }] in document order.
 * `kind` is "block" for prose, "attr" for an attribute value, "meta" for head
 * metadata whose value lives in a content="" attribute.
 */
export function extract(html) {
  const doc = parse(html);
  const units = [];
  const seen = new Set();

  const add = (text, kind, extra) => {
    const trimmed = text.trim();
    if (!translatable(trimmed)) return;
    const key = kind + " " + trimmed;
    if (seen.has(key)) return;
    seen.add(key);
    units.push({ text: trimmed, kind, ...extra });
  };

  walk(doc, (el) => {
    if (el.name !== "meta") return;
    const name = attr(el, "name") || attr(el, "property");
    if (!name) return;
    if (!/^(description|og:title|og:description|twitter:title|twitter:description)$/.test(name)) return;
    add(attr(el, "content") || "", "meta", { meta: name });
  });

  walk(doc, (el) => {
    for (const a of ATTRS) {
      const value = attr(el, a);
      if (value) add(value, "attr", { attr: a });
    }
  });

  const descend = (node) => {
    for (const child of node.children || []) {
      if (child.type === "text") {
        if (node.name !== "script" && node.name !== "style") add(child.value, "block");
        continue;
      }
      if (child.type !== "element") continue;
      if (child.name === "script" || child.name === "style") continue;
      if (child.name === "title") {
        add(inner(child), "block");
        continue;
      }
      if (CONTAINER.has(child.name) || hasBlock(child)) {
        descend(child);
        continue;
      }
      if (LEAF.has(child.name)) {
        add(inner(child), "block");
        continue;
      }
      descend(child);
    }
  };
  descend(doc);

  return units;
}
