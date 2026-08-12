/**
 * Password hashing and session tokens.
 *
 * scrypt, from `node:crypto`. No dependency, no native build, and a deliberately
 * slow function — the whole point is that an attacker who steals the database
 * cannot test billions of candidate passwords a second.
 *
 * Three properties this file exists to guarantee:
 *
 *   - Every password gets its own random salt, so two people with the same
 *     password do not share a hash and a rainbow table is useless.
 *   - Comparison is timing-safe. A byte-by-byte `===` leaks, through response
 *     time, how much of a hash an attacker got right.
 *   - Verifying a password that does not exist costs the same as verifying one
 *     that does, so login cannot be used to enumerate registered addresses.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * scrypt cost. N=16384 is the widely recommended interactive-login setting:
 * roughly 50–100ms per hash on a small server, which is imperceptible to a
 * person logging in and ruinous to someone testing a wordlist.
 */
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

export interface PasswordRecord {
  hash: string;
  salt: string;
}

/** Rejected before hashing — a rule the database cannot express. */
export const MIN_PASSWORD_LENGTH = 10;

export class WeakPasswordError extends Error {
  readonly status = 400;
  constructor(reason: string) {
    super(reason);
    this.name = "WeakPasswordError";
  }
}

/**
 * A length floor and nothing else.
 *
 * Composition rules ("one capital, one symbol") push people toward `Password1!`
 * and away from long passphrases, which are stronger. Length is the requirement
 * that actually correlates with strength.
 */
export function assertPasswordAcceptable(password: string): void {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (password.length > 512) {
    // A megabyte password is a denial-of-service request, not a login.
    throw new WeakPasswordError("That password is too long.");
  }
}

function derive(password: string, salt: Buffer): Buffer {
  return scryptSync(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELISM,
    // scrypt needs memory proportional to N·r; the default limit rejects N=16384.
    maxmem: 64 * 1024 * 1024,
  });
}

export function hashPassword(password: string): PasswordRecord {
  assertPasswordAcceptable(password);
  const salt = randomBytes(SALT_BYTES);
  return { hash: derive(password, salt).toString("hex"), salt: salt.toString("hex") };
}

/**
 * Verify, in constant time relative to how much of the hash matched.
 *
 * Returns false rather than throwing on a malformed stored record: a corrupt row
 * should fail the login, not crash the login endpoint for everyone.
 */
export function verifyPassword(password: string, record: PasswordRecord): boolean {
  try {
    const salt = Buffer.from(record.salt, "hex");
    const expected = Buffer.from(record.hash, "hex");
    if (salt.length === 0 || expected.length !== KEY_LENGTH) return false;
    const actual = derive(password, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Burn the same work as a real verification, for an address that does not exist.
 *
 * Without this, "no such user" returns in microseconds while a real user's
 * failed login takes ~80ms, and that difference is a free account-enumeration
 * oracle for anyone with a stopwatch.
 */
export function wasteVerificationTime(): void {
  derive("timing-equalisation", Buffer.alloc(SALT_BYTES, 0));
}

/* --- Session tokens ------------------------------------------------------- */

/**
 * 256 bits from the CSPRNG.
 *
 * Not a JWT: a server-side session row can be revoked instantly, which is what
 * "log out everywhere" and "we think this account is compromised" both need. A
 * signed token that is valid until it expires cannot do either.
 */
export const newSessionToken = (): string => randomBytes(32).toString("base64url");

export const SESSION_TTL_HOURS = 24 * 14;

export function sessionExpiry(from: Date = new Date(), hours = SESSION_TTL_HOURS): string {
  return new Date(from.getTime() + hours * 3_600_000).toISOString();
}

export const sessionIsLive = (expiresAt: string, now: Date = new Date()): boolean =>
  new Date(expiresAt).getTime() > now.getTime();
