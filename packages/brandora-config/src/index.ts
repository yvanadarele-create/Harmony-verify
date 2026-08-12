/**
 * The only module in Brandora that reads a credential from the environment.
 *
 * Spec §29 sets three rules and this file is how they are kept:
 *
 *   1. Credentials are never literals in the repository. They arrive through the
 *      environment, entered by the Brandora administrator in the deployment's
 *      encrypted settings — nowhere else.
 *   2. The App Secret, Access Token and Refresh Token never reach the frontend.
 *      Nothing here is importable from a browser bundle: the sourcing engine
 *      runs server-side and is the only consumer.
 *   3. Credentials never appear in a log, an error, or an AI prompt. The only
 *      function that returns anything about them for display is `maskCredential`,
 *      and it returns a mask, not a value.
 *
 * The tunable business numbers live here too, because §66 requires the sourcing
 * thresholds to be configurable rather than hard-coded, and a margin that can
 * only be changed by a deploy is a margin nobody tunes.
 */

import { type CurrencyCode, DEFAULT_CURRENCY, isCurrency } from "@brandora/shared";

export class MissingConfigError extends Error {
  readonly status = 500;
  constructor(readonly key: string, hint: string) {
    super(`Missing required environment variable ${key}. ${hint}`);
    this.name = "MissingConfigError";
  }
}

type Env = Record<string, string | undefined>;

const env = (): Env => (typeof process === "undefined" ? {} : process.env);

function required(key: string, hint: string, source: Env = env()): string {
  const value = source[key];
  if (!value || value.trim() === "") throw new MissingConfigError(key, hint);
  return value.trim();
}

function optional(key: string, fallback: string, source: Env = env()): string {
  const value = source[key];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

function numeric(key: string, fallback: number, source: Env = env()): number {
  const raw = source[key];
  if (!raw || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/* --- Supplier credentials ------------------------------------------------ */

const ALIEXPRESS_HINT =
  "Set it in the deployment's encrypted environment settings. Admin → Integrations → AliExpress explains where.";

/** Public in AliExpress's model, but still read from the environment, not code. */
export function aliexpressAppKey(source: Env = env()): string {
  return required("ALIEXPRESS_APP_KEY", ALIEXPRESS_HINT, source);
}

/** SECRET. Signs every request. Server-side only, never logged, never prompted. */
export function aliexpressAppSecret(source: Env = env()): string {
  return required("ALIEXPRESS_APP_SECRET", ALIEXPRESS_HINT, source);
}

/** SECRET. Bearer for the authorised account. */
export function aliexpressAccessToken(source: Env = env()): string {
  return required("ALIEXPRESS_ACCESS_TOKEN", ALIEXPRESS_HINT, source);
}

/** SECRET. Mints new access tokens; a leak outlives the access token itself. */
export function aliexpressRefreshToken(source: Env = env()): string {
  return required("ALIEXPRESS_REFRESH_TOKEN", ALIEXPRESS_HINT, source);
}

export function aliexpressEndpoint(source: Env = env()): string {
  return optional("ALIEXPRESS_ENDPOINT", "https://api-sg.aliexpress.com/sync", source);
}

/**
 * Whether the integration is configured, without reading any secret into a
 * caller's hands. This is what the admin page's "Connected ✓" is driven from.
 */
export function aliexpressConfigured(source: Env = env()): boolean {
  return (
    ["ALIEXPRESS_APP_KEY", "ALIEXPRESS_APP_SECRET", "ALIEXPRESS_ACCESS_TOKEN"] as const
  ).every((k) => {
    const v = source[k];
    return typeof v === "string" && v.trim() !== "";
  });
}

/* --- AI ------------------------------------------------------------------ */

export function anthropicApiKey(source: Env = env()): string {
  return required("ANTHROPIC_API_KEY", "Needed for brand generation and the assistant.", source);
}

export function anthropicModel(source: Env = env()): string {
  return optional("ANTHROPIC_MODEL", "claude-sonnet-5", source);
}

export const aiConfigured = (source: Env = env()): boolean => {
  const v = source["ANTHROPIC_API_KEY"];
  return typeof v === "string" && v.trim() !== "";
};

/* --- Commercial settings ------------------------------------------------- */

export function defaultCurrency(source: Env = env()): CurrencyCode {
  const raw = optional("BRANDORA_DEFAULT_CURRENCY", DEFAULT_CURRENCY, source).toUpperCase();
  return isCurrency(raw) ? raw : DEFAULT_CURRENCY;
}

/** Brandora's margin on the landed cost, as a rate. 0.35 = 35%. */
export function marginRate(source: Env = env()): number {
  return numeric("BRANDORA_MARGIN_RATE", 0.35, source);
}

/** Local handling, storage and last-mile coordination, as a rate on goods. */
export function logisticsRate(source: Env = env()): number {
  return numeric("BRANDORA_LOGISTICS_RATE", 0.08, source);
}

/**
 * Where the sourcing strategy changes gear (§66). Small orders go to low-MOQ
 * suppliers; large ones justify approaching manufacturers directly. These are
 * business judgements that will move, so they are settings, not constants.
 */
export interface SourcingThresholds {
  smallMax: number;
  mediumMax: number;
}

export function sourcingThresholds(source: Env = env()): SourcingThresholds {
  return {
    smallMax: numeric("BRANDORA_SOURCING_SMALL_MAX", 50, source),
    mediumMax: numeric("BRANDORA_SOURCING_MEDIUM_MAX", 500, source),
  };
}

/** How long cached supplier data is treated as fresh (§75). */
export function supplierCacheTtlMinutes(source: Env = env()): number {
  return numeric("BRANDORA_SUPPLIER_CACHE_TTL_MINUTES", 360, source);
}

export function publicBaseUrl(source: Env = env()): string {
  return optional("BRANDORA_PUBLIC_BASE_URL", "http://localhost:4100", source);
}

/* --- Persistence --------------------------------------------------------- */

/**
 * Where Brandora's database lives.
 *
 * Separate from Harmony's `DATABASE_PATH` so the two products cannot end up
 * sharing a file: one schema's migration would corrupt the other's tables, and
 * the failure would look like data loss rather than a configuration mistake.
 */
export function databasePath(source: Env = env()): string {
  return optional("BRANDORA_DATABASE_PATH", "./data/brandora.db", source);
}

/**
 * Signs session cookies.
 *
 * Required rather than defaulted: a development fallback here is a fallback
 * that reaches production, and a known signing secret means anyone can mint a
 * session for any account.
 */
export function authSecret(source: Env = env()): string {
  return required(
    "BRANDORA_AUTH_SECRET",
    "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    source,
  );
}

/* --- Display ------------------------------------------------------------- */

/**
 * The only representation of a credential this module will produce.
 *
 * Shows the last four characters so an administrator can confirm *which* key is
 * installed without the screen, a screenshot or a support ticket carrying the
 * key itself. Short values are masked completely — four of eight characters is
 * a meaningful head start for an attacker.
 */
export function maskCredential(value: string | undefined): string {
  if (!value || value.trim() === "") return "Not set";
  const trimmed = value.trim();
  if (trimmed.length < 12) return "•".repeat(8);
  return `${"•".repeat(8)}${trimmed.slice(-4)}`;
}

export interface IntegrationStatus {
  name: string;
  connected: boolean;
  fields: { label: string; masked: string }[];
}

/**
 * Powers Admin → Integrations → AliExpress (§30).
 *
 * Returns masks and booleans only. There is deliberately no variant of this
 * function that returns the real values for "just this one admin screen" — that
 * is how secrets end up in an HTML response.
 */
export function aliexpressIntegrationStatus(source: Env = env()): IntegrationStatus {
  return {
    name: "AliExpress",
    connected: aliexpressConfigured(source),
    fields: [
      { label: "App Key", masked: maskCredential(source["ALIEXPRESS_APP_KEY"]) },
      { label: "App Secret", masked: maskCredential(source["ALIEXPRESS_APP_SECRET"]) },
      { label: "Access Token", masked: maskCredential(source["ALIEXPRESS_ACCESS_TOKEN"]) },
      { label: "Refresh Token", masked: maskCredential(source["ALIEXPRESS_REFRESH_TOKEN"]) },
    ],
  };
}

/** A start-up report: what is present, never what it is. */
export function describeConfig(source: Env = env()): Record<string, string> {
  return {
    defaultCurrency: defaultCurrency(source),
    marginRate: String(marginRate(source)),
    logisticsRate: String(logisticsRate(source)),
    aliexpress: aliexpressConfigured(source) ? "configured" : "not configured",
    ai: aiConfigured(source) ? "configured" : "not configured",
    publicBaseUrl: publicBaseUrl(source),
  };
}
