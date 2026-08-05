/**
 * Staff accounts and sessions.
 *
 * Customers never get an account — a phone number is enough to tie a request to a
 * customer record. Only the admin side authenticates, with scrypt hashes and
 * opaque session tokens stored server-side so a session can be revoked.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { AdminUser } from "@delices/core";
import { id } from "@delices/core";
import { nowIso, str, type Db, type Row } from "./db.js";

const SCRYPT_KEYLEN = 64;
const SESSION_TTL_HOURS = 12;

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return { hash, salt };
}

function verifyPassword(password: string, hash: string, salt: string): boolean {
  const candidate = scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, "hex");
  if (expected.length !== candidate.length) return false;
  return timingSafeEqual(candidate, expected);
}

const toUser = (row: Row): AdminUser => ({
  id: str(row, "id"),
  name: str(row, "name"),
  email: str(row, "email"),
  role: str(row, "role") === "owner" ? "owner" : "staff",
  createdAt: str(row, "created_at"),
});

export function createUser(
  db: Db,
  input: { name: string; email: string; password: string; role?: "owner" | "staff" },
): AdminUser {
  const userId = id("usr");
  const { hash, salt } = hashPassword(input.password);
  db.prepare("INSERT INTO users (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)").run(
    userId,
    input.name,
    input.email,
    input.role ?? "owner",
    nowIso(),
  );
  db.prepare(
    "INSERT INTO user_credentials (user_id, password_hash, password_salt) VALUES (?, ?, ?)",
  ).run(userId, hash, salt);
  return toUser(
    db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as Row,
  );
}

export function countUsers(db: Db): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM users").get() as Row;
  return Number(row.n ?? 0);
}

export function listUsers(db: Db): AdminUser[] {
  return (db.prepare("SELECT * FROM users ORDER BY created_at").all() as Row[]).map(toUser);
}

export function findUserByEmail(db: Db, email: string): AdminUser | null {
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as Row | undefined;
  return row ? toUser(row) : null;
}

/**
 * Returns the user when the password matches. A wrong email still runs a hash so the
 * response time does not tell an attacker which addresses exist.
 */
export function authenticate(db: Db, email: string, password: string): AdminUser | null {
  const row = db
    .prepare(
      `SELECT u.*, c.password_hash, c.password_salt
       FROM users u JOIN user_credentials c ON c.user_id = u.id
       WHERE u.email = ?`,
    )
    .get(email) as Row | undefined;
  if (!row) {
    scryptSync(password, "absent", SCRYPT_KEYLEN);
    return null;
  }
  const ok = verifyPassword(password, str(row, "password_hash"), str(row, "password_salt"));
  return ok ? toUser(row) : null;
}

export function setPassword(db: Db, userId: string, password: string): void {
  const { hash, salt } = hashPassword(password);
  db.prepare(
    "UPDATE user_credentials SET password_hash = ?, password_salt = ? WHERE user_id = ?",
  ).run(hash, salt, userId);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function createSession(db: Db, userId: string): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600_000).toISOString();
  db.prepare(
    "INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
  ).run(token, userId, expiresAt, nowIso());
  return { token, expiresAt };
}

export function userForSession(db: Db, token: string): AdminUser | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`,
    )
    .get(token, nowIso()) as Row | undefined;
  return row ? toUser(row) : null;
}

export function destroySession(db: Db, token: string): void {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function purgeExpiredSessions(db: Db): void {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(nowIso());
}
