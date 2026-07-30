import { deflateRawSync, crc32 } from "node:zlib";
import type { VerificationReport } from "./report.js";

/**
 * A minimal .docx writer.
 *
 * A .docx is a ZIP of XML parts, and both halves are small enough to write
 * directly. Same reasoning as the PDF writer: this file is the customer's
 * evidence, and every dependency between a clinician's judgement and the
 * document a committee opens is a way for that document to be wrong.
 *
 * Word exists alongside the PDF because governance committees paste findings
 * into their own templates. Handing them a locked PDF makes that harder than it
 * needs to be, and the predictable result is somebody retyping a clinical
 * correction by hand.
 */

/* --- ZIP -------------------------------------------------------------------- */

interface Entry {
  name: string;
  data: Buffer;
}

/** DOS timestamp. Fixed rather than "now" so identical input yields an identical file. */
const DOS_TIME = ((12 << 11) | (0 << 5) | 0) & 0xffff;
const DOS_DATE = (((2026 - 1980) << 9) | (1 << 5) | 1) & 0xffff;

function zip(entries: Entry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const deflated = deflateRawSync(entry.data, { level: 9 });
    // Deflate is only worth it if it actually shrank the part.
    const useDeflate = deflated.length < entry.data.length;
    const body = useDeflate ? deflated : entry.data;
    const method = useDeflate ? 8 : 0;
    const sum = crc32(entry.data) >>> 0;

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);

    locals.push(local, body);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);

    offset += local.length + body.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, end]);
}

/* --- WordprocessingML -------------------------------------------------------- */

const xmlEscape = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const GOLD = "A8842A";
const INK = "101B36";
const MUTED = "59667F";

interface RunStyle {
  bold?: boolean;
  size?: number; // points
  colour?: string;
  caps?: boolean;
  font?: string;
}

function para(text: string, style: RunStyle = {}, spacingBefore = 120): string {
  const size = Math.round((style.size ?? 10) * 2); // half-points
  const rPr =
    `<w:rPr>` +
    (style.font ? `<w:rFonts w:ascii="${style.font}" w:hAnsi="${style.font}"/>` : "") +
    (style.bold ? "<w:b/>" : "") +
    (style.caps ? "<w:caps/>" : "") +
    `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` +
    `<w:color w:val="${style.colour ?? INK}"/>` +
    `</w:rPr>`;
  return (
    `<w:p><w:pPr><w:spacing w:before="${spacingBefore}" w:after="60" w:line="276" w:lineRule="auto"/></w:pPr>` +
    `<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`
  );
}

function table(rows: Array<[string, string]>): string {
  const cells = rows
    .map(
      ([label, value]) =>
        `<w:tr>` +
        `<w:tc><w:tcPr><w:tcW w:w="3200" w:type="dxa"/></w:tcPr>` +
        `<w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr>` +
        `<w:r><w:rPr><w:sz w:val="19"/><w:color w:val="${MUTED}"/></w:rPr>` +
        `<w:t xml:space="preserve">${xmlEscape(label)}</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:tcPr><w:tcW w:w="6000" w:type="dxa"/></w:tcPr>` +
        `<w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr>` +
        `<w:r><w:rPr><w:b/><w:sz w:val="20"/><w:color w:val="${INK}"/></w:rPr>` +
        `<w:t xml:space="preserve">${xmlEscape(value)}</w:t></w:r></w:p></w:tc>` +
        `</w:tr>`,
    )
    .join("");

  return (
    `<w:tbl><w:tblPr><w:tblW w:w="9200" w:type="dxa"/>` +
    `<w:tblBorders>` +
    ["top", "left", "bottom", "right", "insideH", "insideV"]
      .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="D8DEE9"/>`)
      .join("") +
    `</w:tblBorders></w:tblPr>${cells}</w:tbl>`
  );
}

function documentXml(report: VerificationReport): string {
  const parts: string[] = [];

  parts.push(para(report.title, { size: 22, bold: true, font: "Georgia" }, 0));
  parts.push(para(report.subtitle, { size: 11, colour: MUTED }, 60));
  parts.push(
    para(
      `Reference ${report.reference}  ·  Issued ${report.issuedAt}  ·  Verdict: ${report.verdict}  ·  Score ${report.score}/100`,
      { size: 9, colour: GOLD, bold: true },
      60,
    ),
  );

  for (const block of report.blocks) {
    parts.push(para(block.heading, { size: 12.5, bold: true, font: "Georgia" }, 320));
    for (const paragraph of block.body ?? []) parts.push(para(paragraph, { size: 10 }));
    if (block.rows && block.rows.length) parts.push(table(block.rows));
    for (const bullet of block.bullets ?? []) parts.push(para(`•  ${bullet}`, { size: 10 }));
  }

  parts.push(para(report.footer, { size: 8, colour: MUTED }, 400));

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${parts.join("")}` +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>` +
    `<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/>` +
    `</w:sectPr></w:body></w:document>`
  );
}

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
  `</Types>`;

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
  `</Relationships>`;

const DOC_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;

const coreXml = (report: VerificationReport): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
  `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ` +
  `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
  `<dc:title>${xmlEscape(`${report.title} — ${report.reference}`)}</dc:title>` +
  `<dc:creator>Harmony Verify</dc:creator>` +
  `<cp:lastModifiedBy>Harmony Verify</cp:lastModifiedBy>` +
  `<dcterms:created xsi:type="dcterms:W3CDTF">${report.issuedAt}T00:00:00Z</dcterms:created>` +
  `</cp:coreProperties>`;

/** Renders the report as a .docx package. */
export function toDocx(report: VerificationReport): Uint8Array {
  return zip([
    { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(ROOT_RELS, "utf8") },
    { name: "docProps/core.xml", data: Buffer.from(coreXml(report), "utf8") },
    { name: "word/document.xml", data: Buffer.from(documentXml(report), "utf8") },
    { name: "word/_rels/document.xml.rels", data: Buffer.from(DOC_RELS, "utf8") },
  ]);
}
