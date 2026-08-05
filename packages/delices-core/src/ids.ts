import { randomUUID, randomBytes } from "node:crypto";

/** Prefixed ids read well in logs and in the admin URL bar. */
export function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/** Unambiguous alphabet: no O/0, no I/1 — these get read out over the phone. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * A customer-facing reference such as `GL-260805-K4M2`. Date-prefixed so Grace can
 * see at a glance when a request came in, with enough randomness that references
 * cannot be guessed by counting up from someone else's.
 */
export function orderReference(now: Date = new Date()): string {
  const yy = String(now.getUTCFullYear()).slice(2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const bytes = randomBytes(4);
  let tail = "";
  for (let i = 0; i < 4; i++) tail += ALPHABET[bytes[i]! % ALPHABET.length];
  return `GL-${yy}${mm}${dd}-${tail}`;
}

/** A url-safe slug from a product name; falls back to a random suffix if empty. */
export function slugify(input: string): string {
  const base = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || `item-${randomBytes(3).toString("hex")}`;
}
