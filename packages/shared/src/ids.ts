import { randomUUID, createHash } from "node:crypto";

/**
 * Human-readable, prefixed identifiers. The prefix makes an ID self-describing in logs,
 * support tickets and audit records — `sub_…` is obviously a submission.
 */
const PREFIXES = {
  user: "usr",
  expert: "exp",
  submission: "sub",
  review: "rev",
  record: "rec",
  payment: "pay",
  wallet: "wal",
  correction: "cor",
  evidence: "evd",
  audit: "aud",
} as const;

export type IdKind = keyof typeof PREFIXES;

export function newId(kind: IdKind): string {
  return `${PREFIXES[kind]}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function isId(kind: IdKind, value: string): boolean {
  return value.startsWith(`${PREFIXES[kind]}_`);
}

/**
 * Deterministic signature over a verification record body.
 *
 * This detects accidental or casual tampering and gives every record a stable
 * fingerprint. It is NOT a cryptographic attestation of authorship — that requires
 * signing with a managed private key, which belongs in the KMS-backed implementation
 * before any record is presented as legal evidence.
 */
export function signRecord(body: unknown, secret: string): string {
  const canonical = canonicalJson(body);
  return createHash("sha256").update(`${secret}:${canonical}`).digest("hex");
}

/** Stable JSON: object keys sorted recursively, so equal bodies always hash equal. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}
