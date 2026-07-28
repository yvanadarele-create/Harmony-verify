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
 * suite parallel-safe and free of shared fixture state.
 */
export function openDatabase(location = ":memory:"): Db {
  const db = new DatabaseSync(location);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
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
export const toDbBool = (v: boolean | undefined): number | null =>
  v === undefined ? null : v ? 1 : 0;

export const fromDbBool = (v: unknown): boolean | undefined =>
  v === null || v === undefined ? undefined : Boolean(v);

export const toJson = (v: unknown): string => JSON.stringify(v ?? null);

export function fromJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string" || v.length === 0) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

/** SQLite returns `null` for absent columns; the domain types use `undefined`. */
export const orUndefined = <T>(v: T | null | undefined): T | undefined =>
  v === null || v === undefined ? undefined : v;
