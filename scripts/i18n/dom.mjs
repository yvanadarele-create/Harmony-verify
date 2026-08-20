/* A very small HTML parser and serializer.
 *
 * Translating this site means moving whole sentences, and a sentence here is
 * routinely wrapped around inline markup — "the <b>verification layer</b>
 * between your model and…". Splitting on text nodes would hand a translator
 * three fragments and no way to reorder them, which French and Spanish both
 * need. So the site is parsed into a tree, and a translation unit is a block
 * element's inner HTML, inline tags and all.
 *
 * This is not a general-purpose parser. It handles the subset of HTML this site
 * is written in — well-formed, hand-authored, no exotic implicit closing beyond
 * the common cases — and build.mjs refuses to emit anything unless
 * serialize(parse(html)) is byte-identical to the input.
 */

const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

const RAW = new Set(["script", "style"]);

/* Tags that close a currently open tag of the same or a listed kind. */
const IMPLICIT_CLOSE = {
  li: ["li"],
  dt: ["dt", "dd"],
  dd: ["dt", "dd"],
  p: ["p"],
  option: ["option"],
  tr: ["tr", "td", "th"],
  td: ["td", "th"],
  th: ["td", "th"],
  thead: ["tr", "td", "th"],
  tbody: ["tr", "td", "th"],
};

export function parse(html) {
  const root = { type: "root", children: [] };
  const stack = [root];
  let i = 0;
  let text = "";

  const flush = () => {
    if (!text) return;
    stack[stack.length - 1].children.push({ type: "text", value: text });
    text = "";
  };

  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      text += html.slice(i);
      break;
    }
    text += html.slice(i, lt);

    if (html.startsWith("<!--", lt)) {
      flush();
      const end = html.indexOf("-->", lt + 4);
      const stop = end === -1 ? html.length : end + 3;
      stack[stack.length - 1].children.push({ type: "comment", value: html.slice(lt, stop) });
      i = stop;
      continue;
    }
    if (html.startsWith("<!", lt)) {
      flush();
      const end = html.indexOf(">", lt);
      const stop = end === -1 ? html.length : end + 1;
      stack[stack.length - 1].children.push({ type: "doctype", value: html.slice(lt, stop) });
      i = stop;
      continue;
    }

    const gt = findTagEnd(html, lt);
    if (gt === -1) {
      text += html.slice(lt);
      break;
    }
    const raw = html.slice(lt, gt + 1);
    const open = /^<\s*([a-zA-Z][\w-]*)([\s\S]*?)\/?>$/.exec(raw);
    const close = /^<\/\s*([a-zA-Z][\w-]*)\s*>$/.exec(raw);

    if (close) {
      flush();
      const name = close[1].toLowerCase();
      for (let d = stack.length - 1; d > 0; d--) {
        if (stack[d].name === name) {
          stack.length = d;
          break;
        }
      }
      i = gt + 1;
      continue;
    }

    if (!open) {
      text += raw;
      i = gt + 1;
      continue;
    }

    flush();
    const name = open[1].toLowerCase();

    const closes = IMPLICIT_CLOSE[name];
    if (closes) {
      const top = stack[stack.length - 1];
      if (top.name && closes.includes(top.name)) stack.pop();
    }

    const node = {
      type: "element",
      name,
      raw,
      selfClosing: raw.endsWith("/>"),
      children: [],
    };
    stack[stack.length - 1].children.push(node);
    i = gt + 1;

    if (VOID.has(name) || node.selfClosing) continue;

    if (RAW.has(name)) {
      const end = html.toLowerCase().indexOf(`</${name}`, i);
      const stop = end === -1 ? html.length : end;
      if (stop > i) node.children.push({ type: "text", value: html.slice(i, stop) });
      node.rawText = true;
      i = stop;
      continue;
    }

    stack.push(node);
  }
  flush();
  return root;
}

export function serialize(node) {
  if (node.type === "root") return node.children.map(serialize).join("");
  if (node.type === "text") return node.value;
  if (node.type === "comment" || node.type === "doctype") return node.value;

  const inner = node.children.map(serialize).join("");
  if (VOID.has(node.name) || node.selfClosing) return node.raw;
  return node.raw + inner + `</${node.name}>`;
}

/** Inner HTML of an element node. */
export function inner(node) {
  return node.children.map(serialize).join("");
}

/** Replace an element's children with parsed HTML. */
export function setInner(node, html) {
  node.children = parse(html).children;
}

/** Depth-first walk over element nodes. */
export function walk(node, visit) {
  for (const child of node.children || []) {
    if (child.type === "element") {
      visit(child);
      if (!child.rawText) walk(child, visit);
    }
  }
}

/** Read an attribute off an element's raw tag text. */
export function attr(node, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i").exec(node.raw);
  return m ? m[1] : null;
}

/** Rewrite one attribute in place on an element's raw tag text. */
export function setAttr(node, name, value) {
  const re = new RegExp(`(\\s${name}\\s*=\\s*")([^"]*)(")`, "i");
  if (re.test(node.raw)) {
    node.raw = node.raw.replace(re, (_m, a, _old, c) => a + value + c);
    return true;
  }
  const insert = node.raw.endsWith("/>") ? -2 : -1;
  node.raw = node.raw.slice(0, insert) + ` ${name}="${value}"` + node.raw.slice(insert);
  return true;
}

function findTagEnd(html, lt) {
  let quote = null;
  for (let i = lt + 1; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ">") return i;
  }
  return -1;
}
