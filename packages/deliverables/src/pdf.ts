import type { VerificationReport } from "./report.js";

/**
 * A minimal PDF writer.
 *
 * Hand-rolled rather than pulled from a library, for one reason: this document
 * is the customer's evidence, and the fewer third-party packages sit between a
 * clinician's judgement and the file a governance committee opens, the fewer
 * ways that file can be wrong or that supply chain can be compromised. The
 * subset needed here — text, in one of the fourteen standard fonts, laid out on
 * A4 — is a few hundred lines of well-specified format.
 *
 * Standard fonts mean no font embedding, which keeps the file small and means it
 * renders identically in every reader without a licensing question.
 */

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = { top: 64, bottom: 64, left: 56, right: 56 };
const CONTENT_WIDTH = A4.width - MARGIN.left - MARGIN.right;

const FONT = { body: "F1", bold: "F2", display: "F3" };

/** Widths for Helvetica at 1pt, indexed by char code 32–126. Enough for wrapping. */
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const BOLD_FACTOR = 1.06;

function textWidth(text: string, size: number, bold = false): number {
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const w = code >= 32 && code <= 126 ? HELVETICA_WIDTHS[code - 32]! : 556;
    total += w;
  }
  return (total / 1000) * size * (bold ? BOLD_FACTOR : 1);
}

function wrap(text: string, size: number, width: number, bold = false): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, size, bold) > width && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * PDF string escaping.
 *
 * WinAnsi is the encoding declared below, so anything outside it is transliterated
 * rather than emitted raw — an en dash written as a raw byte renders as a random
 * glyph, which looks like corruption in a document whose whole job is to be
 * trusted.
 */
const TRANSLITERATE: Record<string, string> = {
  // Octal, in WinAnsiEncoding: emdash is 0x97 and endash 0x96. Reaching for the
  // Latin-1 code point instead prints Ð, which reads as file corruption.
  "—": "\\227",
  "–": "\\226",
  "’": "'",
  "‘": "'",
  "“": '"',
  "”": '"',
  "…": "...",
  "·": "\\267",
  "−": "-",
  "×": "x",
  "≥": ">=",
  "≤": "<=",
  "£": "\\243",
  "€": "\\200",
  "°": "\\260",
};

function escape(text: string): string {
  let out = "";
  for (const char of text) {
    if (TRANSLITERATE[char]) {
      out += TRANSLITERATE[char];
      continue;
    }
    const code = char.charCodeAt(0);
    if (char === "\\") out += "\\\\";
    else if (char === "(") out += "\\(";
    else if (char === ")") out += "\\)";
    else if (code >= 32 && code <= 126) out += char;
    else if (code <= 255) out += "\\" + code.toString(8).padStart(3, "0");
    else out += "?";
  }
  return out;
}

/* --- Layout ---------------------------------------------------------------- */

interface Op {
  font: string;
  size: number;
  text: string;
  /** Space above this line. */
  lead: number;
  colour?: [number, number, number];
  /** Absolute x offset from the left margin, for table columns. */
  x?: number;
  /** True when this line shares a baseline with the previous one. */
  sameLine?: boolean;
  rule?: boolean;
}

const GOLD: [number, number, number] = [0.831, 0.686, 0.216];
const INK: [number, number, number] = [0.06, 0.09, 0.16];
const MUTED: [number, number, number] = [0.35, 0.4, 0.5];

function layout(report: VerificationReport): Op[] {
  const ops: Op[] = [];

  ops.push({ font: FONT.display, size: 22, text: report.title, lead: 0, colour: INK });
  ops.push({ font: FONT.body, size: 11, text: report.subtitle, lead: 20, colour: MUTED });
  ops.push({
    font: FONT.body,
    size: 9,
    text: `Reference ${report.reference}  ·  Issued ${report.issuedAt}  ·  Verdict: ${report.verdict}  ·  Score ${report.score}/100`,
    lead: 14,
    colour: GOLD,
  });
  ops.push({ font: FONT.body, size: 9, text: "", lead: 10, rule: true });

  for (const block of report.blocks) {
    ops.push({ font: FONT.bold, size: 12, text: block.heading, lead: 26, colour: INK });

    for (const paragraph of block.body ?? []) {
      let first = true;
      for (const line of wrap(paragraph, 10, CONTENT_WIDTH)) {
        ops.push({ font: FONT.body, size: 10, text: line, lead: first ? 14 : 13.6, colour: INK });
        first = false;
      }
    }

    for (const [label, value] of block.rows ?? []) {
      const labelWidth = CONTENT_WIDTH * 0.36;
      const valueLines = wrap(value, 10, CONTENT_WIDTH - labelWidth - 12);
      ops.push({ font: FONT.body, size: 9.5, text: label, lead: 14, colour: MUTED });
      valueLines.forEach((line, i) => {
        ops.push({
          font: FONT.bold,
          size: 10,
          text: line,
          lead: i === 0 ? 0 : 13,
          colour: INK,
          x: labelWidth,
          sameLine: i === 0,
        });
      });
    }

    for (const bullet of block.bullets ?? []) {
      const lines = wrap(bullet, 10, CONTENT_WIDTH - 14);
      lines.forEach((line, i) => {
        ops.push({
          font: FONT.body,
          size: 10,
          text: i === 0 ? `\\267  ${line}` : `   ${line}`,
          lead: i === 0 ? 14 : 13.6,
          colour: INK,
        });
      });
    }
  }

  return ops;
}

/* --- Emission --------------------------------------------------------------- */

function pageStreams(ops: Op[], footer: string): string[] {
  const pages: string[] = [];
  let content = "";
  let y = A4.height - MARGIN.top;
  const bottom = MARGIN.bottom + 22;

  const startPage = () => {
    content = "";
    y = A4.height - MARGIN.top;
  };

  const endPage = () => {
    content +=
      `BT /${FONT.body} 8 Tf ${MUTED.join(" ")} rg ` +
      `1 0 0 1 ${MARGIN.left} ${MARGIN.bottom - 12} Tm (${escape(footer)}) Tj ET\n`;
    pages.push(content);
  };

  startPage();

  for (const op of ops) {
    if (!op.sameLine) y -= op.lead;

    if (y < bottom) {
      endPage();
      startPage();
      y -= op.lead;
    }

    if (op.rule) {
      const [r, g, b] = GOLD;
      content += `${r} ${g} ${b} RG 0.6 w ${MARGIN.left} ${y + 4} m ${A4.width - MARGIN.right} ${y + 4} l S\n`;
      continue;
    }

    if (!op.text) continue;

    const [r, g, b] = op.colour ?? INK;
    const x = MARGIN.left + (op.x ?? 0);
    content += `BT /${op.font} ${op.size} Tf ${r} ${g} ${b} rg 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${escape(op.text)}) Tj ET\n`;
  }

  endPage();
  return pages;
}

/** Renders the report as a PDF byte string. */
export function toPdf(report: VerificationReport): Uint8Array {
  const streams = pageStreams(layout(report), report.footer);

  const objects: string[] = [];
  const add = (body: string): number => {
    objects.push(body);
    return objects.length; // 1-indexed object numbers
  };

  // Reserve 1 (catalog) and 2 (pages); fonts and content follow.
  objects.push("", "");

  const fonts = [
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"),
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"),
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>"),
  ];

  const fontDict = `<< /F1 ${fonts[0]} 0 R /F2 ${fonts[1]} 0 R /F3 ${fonts[2]} 0 R >>`;

  const pageIds: number[] = [];
  for (const stream of streams) {
    const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
    pageIds.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] ` +
          `/Resources << /Font ${fontDict} >> /Contents ${contentId} 0 R >>`,
      ),
    );
  }

  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  // Latin-1: every byte in the string is already a byte in the file.
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}
