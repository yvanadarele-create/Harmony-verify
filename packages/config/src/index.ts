/**
 * Every secret and every deployment-specific value the platform needs, read from
 * the environment in one place.
 *
 * Three rules this module exists to enforce:
 *
 *   1. No secret is ever a literal in the repository. The repository is public;
 *      a key committed here is a key published to the world.
 *   2. A missing secret fails loudly at the point of use, not silently three
 *      layers down as an "unauthorised" response from a payment provider.
 *   3. Secrets are never logged or serialised. `describeConfig()` reports which
 *      values are present, never what they are.
 */

/** Values that are safe to render in a page, a log line, or an error. */
export interface PublicConfig {
  adminEmail: string;
  paystackPublicKey: string;
  publicBaseUrl: string;
  nodeEnv: "development" | "test" | "production";
}

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

/* --- Identity ------------------------------------------------------------ */

export const DEFAULT_ADMIN_EMAIL = "yvanadarele@gmail.com";

/**
 * The account that holds the admin role. Comparison is case-insensitive because
 * mail providers treat addresses that way and an admin check that fails on
 * capitalisation is a lockout waiting to happen.
 */
export function adminEmail(source: Env = env()): string {
  return optional("ADMIN_EMAIL", DEFAULT_ADMIN_EMAIL, source).toLowerCase();
}

export function isAdminEmail(candidate: string | null | undefined, source: Env = env()): boolean {
  if (!candidate) return false;
  return candidate.trim().toLowerCase() === adminEmail(source);
}

/* --- Secrets ------------------------------------------------------------- */

/**
 * Server-side only. A `sk_live_` key can move real money, so it must never reach
 * a browser bundle, a client component, a log line, or an error message.
 */
export function paystackSecretKey(source: Env = env()): string {
  const key = required(
    "PAYSTACK_SECRET_KEY",
    "Set it in .env locally and in the Vercel project's encrypted environment variables.",
    source,
  );
  if (!/^sk_(test|live)_/.test(key)) {
    throw new MissingConfigError(
      "PAYSTACK_SECRET_KEY",
      "Expected a key beginning sk_test_ or sk_live_ — a public pk_ key cannot authorise a charge.",
    );
  }
  return key;
}

/** Safe to embed in a page: this is what the checkout widget uses. */
export function paystackPublicKey(source: Env = env()): string {
  return optional("PAYSTACK_PUBLIC_KEY", "", source);
}

/** Paystack signs webhooks with the secret key unless a dedicated one is set. */
export function paystackWebhookSecret(source: Env = env()): string {
  return optional("PAYSTACK_WEBHOOK_SECRET", "", source) || paystackSecretKey(source);
}

export function anthropicApiKey(source: Env = env()): string {
  return required(
    "ANTHROPIC_API_KEY",
    "Set it server-side only. The browser must never see this value.",
    source,
  );
}

export function anthropicModel(source: Env = env()): string {
  return optional("ANTHROPIC_MODEL", "claude-sonnet-5", source);
}

/**
 * Encrypts expert bank account numbers at rest. Durable state, not a throwaway:
 * rotating it without re-encrypting existing rows makes stored account numbers
 * permanently unreadable.
 */
export function payoutEncryptionSecret(source: Env = env()): string {
  return required(
    "PAYOUT_ENCRYPTION_SECRET",
    'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    source,
  );
}

export function sessionSecret(source: Env = env()): string {
  return required("SESSION_SECRET", "Signs session tokens; 32+ random bytes.", source);
}

/* --- Runtime ------------------------------------------------------------- */

export function publicBaseUrl(source: Env = env()): string {
  return optional("PUBLIC_BASE_URL", "http://localhost:4173", source).replace(/\/$/, "");
}

export function paystackCallbackUrl(source: Env = env()): string {
  return optional("PAYSTACK_CALLBACK_URL", `${publicBaseUrl(source)}/payment/complete`, source);
}

export function databasePath(source: Env = env()): string {
  return optional("DATABASE_PATH", "./data/harmony.db", source);
}

export function nodeEnv(source: Env = env()): PublicConfig["nodeEnv"] {
  const value = optional("NODE_ENV", "development", source);
  return value === "production" || value === "test" ? value : "development";
}

export function isProduction(source: Env = env()): boolean {
  return nodeEnv(source) === "production";
}

/** Everything safe to hand to a template or a client. Deliberately narrow. */
export function publicConfig(source: Env = env()): PublicConfig {
  return {
    adminEmail: adminEmail(source),
    paystackPublicKey: paystackPublicKey(source),
    publicBaseUrl: publicBaseUrl(source),
    nodeEnv: nodeEnv(source),
  };
}

/* --- Diagnostics --------------------------------------------------------- */

export interface ConfigStatus {
  key: string;
  present: boolean;
  requiredFor: string;
}

/**
 * Startup diagnostics: which secrets are configured, never what they contain.
 * Booting with a gap here is a deliberate choice — the platform still starts so
 * that a missing Anthropic key does not take payments down with it — but the gap
 * is visible rather than discovered by a customer.
 */
export function describeConfig(source: Env = env()): ConfigStatus[] {
  const has = (key: string): boolean => Boolean(source[key] && source[key]!.trim() !== "");
  return [
    { key: "ADMIN_EMAIL", present: has("ADMIN_EMAIL"), requiredFor: "admin role assignment" },
    { key: "PAYSTACK_SECRET_KEY", present: has("PAYSTACK_SECRET_KEY"), requiredFor: "taking payment" },
    { key: "PAYSTACK_PUBLIC_KEY", present: has("PAYSTACK_PUBLIC_KEY"), requiredFor: "checkout widget" },
    { key: "ANTHROPIC_API_KEY", present: has("ANTHROPIC_API_KEY"), requiredFor: "AI triage and the site assistant" },
    { key: "PAYOUT_ENCRYPTION_SECRET", present: has("PAYOUT_ENCRYPTION_SECRET"), requiredFor: "storing expert bank details" },
    { key: "SESSION_SECRET", present: has("SESSION_SECRET"), requiredFor: "signing sessions" },
  ];
}

/**
 * Redacts anything that looks like a credential before it reaches a log.
 *
 * Belt and braces: nothing in this codebase logs a secret on purpose, but the
 * expensive mistakes are the accidental ones — an error object stringified into
 * a monitoring tool, a request body echoed back during debugging.
 */
const SECRET_PATTERNS: RegExp[] = [
  /\bsk_(?:live|test)_[A-Za-z0-9]+/g,
  /\bpk_(?:live|test)_[A-Za-z0-9]+/g,
  /\bsk-ant-[A-Za-z0-9_-]+/g,
  /\bBearer\s+[A-Za-z0-9._-]{16,}/gi,
];

export function redact(input: string): string {
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[redacted]"), input);
}
