/* A minimal HTML text-node walker.
 *
 * The site has no build step and no dependency on a DOM library, so translating
 * it means locating the text a reader actually sees inside a string of markup.
 * This scans once, tracking whether the cursor is inside a tag, a comment, or a
 * raw-text element, and yields the spans that are prose.
 *
 * It is not a general HTML parser and does not try to be. It handles the subset
 * this site is written in, and check-i18n.mjs asserts that what it produces
 * round-trips back to a byte-identical document.
 */

/** Elements whose contents are never shown to a reader. */
const OPAQUE = new Set(["script", "style"]);

/** Attributes that carry reader-visible text. */
export const TEXT_ATTRS = new Set(["alt", "title", "placeholder", "aria-label", "value"]);

/**
 * Walk `html` and return every reader-visible span.
 * Each span is { start, end, text, kind } where kind is "text" or "attr".
 */
export function scan(html) {
  const spans = [];
  let i = 0;
  let textStart = 0;

  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) break;

    // Comment or doctype — skip wholesale.
    if (html.startsWith("<!--", lt)) {
      pushText(textStart, lt);
      const close = html.indexOf("-->", lt + 4);
      i = close === -1 ? html.length : close + 3;
      textStart = i;
      continue;
    }
    if (html.startsWith("<!", lt)) {
      pushText(textStart, lt);
      const close = html.indexOf(">", lt);
      i = close === -1 ? html.length : close + 1;
      textStart = i;
      continue;
    }

    const tagEnd = findTagEnd(html, lt);
    if (tagEnd === -1) break;

    pushText(textStart, lt);

    const raw = html.slice(lt, tagEnd + 1);
    const nameMatch = /^<\/?\s*([a-zA-Z][\w-]*)/.exec(raw);
    const name = nameMatch ? nameMatch[1].toLowerCase() : "";
    const closing = raw[1] === "/";

    if (!closing) collectAttrs(lt, raw, spans);

    i = tagEnd + 1;
    textStart = i;

    // Raw-text elements: jump to the matching close tag without reading inside.
    if (!closing && OPAQUE.has(name) && !raw.endsWith("/>")) {
      const close = html.toLowerCase().indexOf(`</${name}`, i);
      i = close === -1 ? html.length : close;
      textStart = i;
    }
  }
  pushText(textStart, html.length);

  return spans;

  function pushText(start, end) {
    if (end <= start) return;
    const text = html.slice(start, end);
    if (!text.trim()) return;
    spans.push({ start, end, text, kind: "text" });
  }
}

/** Find the ">" that closes the tag opening at `lt`, ignoring ones inside quotes. */
function findTagEnd(html, lt) {
  let quote = null;
  for (let i = lt + 1; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
  }
  return -1;
}

/** Record translatable attribute values, with offsets relative to the document. */
function collectAttrs(tagStart, raw, spans) {
  const ATTR = /([a-zA-Z-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = ATTR.exec(raw))) {
    const [, name, value] = m;
    if (!TEXT_ATTRS.has(name.toLowerCase())) continue;
    if (!value.trim()) continue;
    const valueStart = tagStart + m.index + m[0].indexOf('"') + 1;
    spans.push({
      start: valueStart,
      end: valueStart + value.length,
      text: value,
      kind: "attr",
      attr: name.toLowerCase(),
    });
  }
}

/** Rewrite a document by replacing spans, right to left so offsets stay valid. */
export function rewrite(html, spans, replacer) {
  const ordered = [...spans].sort((a, b) => b.start - a.start);
  let out = html;
  for (const span of ordered) {
    const next = replacer(span);
    if (next == null || next === span.text) continue;
    out = out.slice(0, span.start) + next + out.slice(span.end);
  }
  return out;
}
