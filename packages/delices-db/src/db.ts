import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export type Db = DatabaseSync;

/**
 * Opens a database and applies the schema.
 *
 * `:memory:` gives each test an isolated database with no cleanup, which keeps the
 * suite parallel-safe. The schema is idempotent, so opening an existing file is
 * simply a no-op rather than a migration step.
 */
export function openDatabase(location = ":memory:"): Db {
  const db = new DatabaseSync(location);
  db.exec("PRAGMA foreign_keys = ON;");
  if (location !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  db.exec(readFileSync(resolve(here, "schema.sql"), "utf8"));
  return db;
}

/** Runs `fn` in a transaction, rolling back if it throws. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export const nowIso = (): string => new Date().toISOString();

/** SQLite has no boolean type; store 0/1 and convert at the boundary. */
export const toBool = (v: boolean): number => (v ? 1 : 0);
export const fromBool = (v: unknown): boolean => Boolean(v);

export const text = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function fromJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string" || v.length === 0) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

export type Row = Record<string, unknown>;

export const str = (row: Row, key: string): string => String(row[key] ?? "");
export const strOrNull = (row: Row, key: string): string | null =>
  row[key] === null || row[key] === undefined ? null : String(row[key]);
export const intOrNull = (row: Row, key: string): number | null =>
  row[key] === null || row[key] === undefined ? null : Number(row[key]);
export const int = (row: Row, key: string): number => Number(row[key] ?? 0);
export const bool = (row: Row, key: string): boolean => Boolean(row[key]);
