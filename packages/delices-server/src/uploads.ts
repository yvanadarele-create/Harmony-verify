/**
 * Image uploads — customer inspiration photos and Grace's own gallery.
 *
 * A single-file `multipart/form-data` parser, because that is all the site sends and
 * a parser you can read end to end is safer than a dependency you cannot. The rules
 * that matter: a hard byte ceiling enforced while reading, an allowlist of image
 * types checked against the file's own magic bytes rather than the name the browser
 * supplied, and a generated filename so nothing a customer types reaches the disk.
 */
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";

export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

const ALLOWED: ReadonlyArray<{ mime: string; ext: string; matches: (b: Buffer) => boolean }> = [
  {
    mime: "image/jpeg",
    ext: "jpg",
    matches: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: "image/png",
    ext: "png",
    matches: (b) =>
      b.length > 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47,
  },
  {
    mime: "image/webp",
    ext: "webp",
    matches: (b) =>
      b.length > 12 && b.subarray(0, 4).toString("ascii") === "RIFF" &&
      b.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

export interface UploadedFile {
  filename: string;
  mimeType: string;
  bytes: Buffer;
}

export type UploadError =
  | { ok: false; status: number; message: string };

export type UploadResult = { ok: true; file: UploadedFile } | UploadError;

/** Reads the request body up to the limit, then extracts the first file part. */
export async function readUpload(req: IncomingMessage): Promise<UploadResult> {
  const contentType = req.headers["content-type"] ?? "";
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!contentType.toLowerCase().startsWith("multipart/form-data") || !boundaryMatch) {
    return { ok: false, status: 400, message: "Format d'envoi invalide." };
  }
  const boundary = (boundaryMatch[1] ?? boundaryMatch[2] ?? "").trim();
  if (!boundary) return { ok: false, status: 400, message: "Format d'envoi invalide." };

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_UPLOAD_BYTES) {
      return { ok: false, status: 413, message: "L'image dépasse 6 Mo." };
    }
    chunks.push(buffer);
  }

  const body = Buffer.concat(chunks);
  const part = firstFilePart(body, boundary);
  if (!part) return { ok: false, status: 400, message: "Aucune image reçue." };

  const allowed = ALLOWED.find((candidate) => candidate.matches(part.bytes));
  if (!allowed) {
    return {
      ok: false,
      status: 415,
      message: "Formats acceptés : JPEG, PNG ou WebP.",
    };
  }
  if (part.bytes.length === 0) return { ok: false, status: 400, message: "Fichier vide." };

  return {
    ok: true,
    file: {
      filename: `${randomBytes(12).toString("hex")}.${allowed.ext}`,
      mimeType: allowed.mime,
      bytes: part.bytes,
    },
  };
}

function firstFilePart(body: Buffer, boundary: string): { bytes: Buffer } | null {
  const delimiter = Buffer.from(`--${boundary}`);
  let index = body.indexOf(delimiter);
  while (index !== -1) {
    const partStart = index + delimiter.length;
    if (body.subarray(partStart, partStart + 2).toString("ascii") === "--") return null; // closing
    const headerEnd = body.indexOf("\r\n\r\n", partStart);
    if (headerEnd === -1) return null;
    const headers = body.subarray(partStart, headerEnd).toString("utf8");
    const nextIndex = body.indexOf(delimiter, headerEnd);
    if (nextIndex === -1) return null;
    // The part payload ends with the CRLF that precedes the next boundary.
    const bytes = body.subarray(headerEnd + 4, nextIndex - 2);
    if (/filename="/i.test(headers)) return { bytes };
    index = nextIndex;
  }
  return null;
}

export async function storeUpload(directory: string, file: UploadedFile): Promise<string> {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, file.filename), file.bytes);
  return `/uploads/${file.filename}`;
}
