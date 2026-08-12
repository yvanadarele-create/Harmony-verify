/**
 * Database connection and the conversions every repository needs.
 *
 * `node:sqlite` is built into Node 22, which is why it is used here: it adds no
 * dependency, no native build step and no connection pool to misconfigure. The
 * same choice Harmony made, for the same reasons.
 */

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { type CurrencyCode, type Money, isCurrency, money } from "@brandora/shared";

const here = dirname(fileURLToPath(import.meta.url));

export type Db = DatabaseSync;

/**
 * Open a database and apply the schema.
 *
 * `:memory:` gives every test an isolated database with nothing to clean up,
 * which keeps the suite parallel-safe and free of shared fixture state.
 */
export function openDatabase(location = ":memory:"): Db {
  const db = new DatabaseSync(location);
  db.exec("PRAGMA foreign_keys = ON;");
  if (location !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  db.exec(readFileSync(resolve(here, "schema.sql"), "utf8"));
  return db;
}

/** Run `fn` in a transaction, rolling back if it throws. */
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

export const toJson = (value: unknown): string => JSON.stringify(value ?? null);

export function fromJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    const parsed = JSON.parse(value) as T;
    return parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

export const text = (value: unknown): string => (typeof value === "string" ? value : String(value ?? ""));

export const optionalText = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

export const int = (value: unknown): number => {
  const parsed = typeof value === "bigint" ? Number(value) : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Rebuild a Money from its two columns.
 *
 * Amount and currency are always stored and read together. A helper that
 * returned just the integer would be the first step toward an amount travelling
 * without its currency, which is how a 1 500 XOF price becomes a 1 500 USD one.
 */
export function readMoney(amount: unknown, currency: unknown): Money {
  const code = text(currency).toUpperCase();
  const resolved: CurrencyCode = isCurrency(code) ? code : "XOF";
  return money(int(amount), resolved);
}
