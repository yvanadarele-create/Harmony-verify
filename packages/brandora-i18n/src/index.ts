/**
 * Internationalisation.
 *
 * Three languages ship in V1 (§23) and the interface must translate wholesale —
 * navigation, forms, catalogue, checkout, notifications, errors. The design
 * choice that makes that hold up over time is typing every catalogue against the
 * English one: a French key that nobody added is a compile error, not an English
 * word sitting in a French checkout months later.
 */

import { type Locale, DEFAULT_LOCALE, LOCALES, isLocale, formatMoney, type Money } from "@brandora/shared";
import { en, type Catalogue, type MessageKey } from "./en.js";
import { fr } from "./fr.js";
import { es } from "./es.js";

export type { Catalogue, MessageKey };
export { en, fr, es };

export const CATALOGUES: Record<Locale, Catalogue> = { en, fr, es };

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
};

/** Flags are used in the language switcher only — never as a proxy for a country. */
export const LOCALE_FLAGS: Record<Locale, string> = { en: "🇬🇧", fr: "🇫🇷", es: "🇪🇸" };

export type Vars = Record<string, string | number>;

/**
 * Look up a message and fill its placeholders.
 *
 * A missing placeholder is left visible as `{name}` rather than blanked. A blank
 * where a total should be looks like a working page with a missing number; the
 * braces make the bug obvious in review.
 */
export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  const catalogue = CATALOGUES[locale] ?? en;
  const template = catalogue[key] ?? en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** Curried form, for a page that has already resolved its locale. */
export function translator(locale: Locale): (key: MessageKey, vars?: Vars) => string {
  return (key, vars) => translate(locale, key, vars);
}

/**
 * Pick a locale from an `Accept-Language` header or a stored preference.
 *
 * Falls back rather than throwing: a browser announcing `pt-BR` gets English,
 * not an error page.
 */
export function negotiateLocale(preference: string | null | undefined): Locale {
  if (!preference) return DEFAULT_LOCALE;
  const candidates = preference
    .split(",")
    .map((part) => part.split(";")[0]?.trim().toLowerCase() ?? "")
    .filter(Boolean);
  for (const candidate of candidates) {
    if (isLocale(candidate)) return candidate;
    const base = candidate.split("-")[0];
    if (base && isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/** Money in the reader's language, so 1 500 FCFA groups the way they expect. */
export const money = (value: Money, locale: Locale): string => formatMoney(value, locale);

/** A date in the reader's language, without a time — quotes are day-precision. */
export function formatDate(iso: string, locale: Locale): string {
  const tag = { en: "en-GB", fr: "fr-FR", es: "es-ES" }[locale];
  return new Intl.DateTimeFormat(tag, { day: "numeric", month: "long", year: "numeric" }).format(
    new Date(iso),
  );
}

/**
 * The instruction appended to an AI turn so the assistant answers in the user's
 * language (§23). Kept here rather than in the AI package because it is a
 * translation concern, and because it must stay in step with `LOCALES`.
 */
export function aiLanguageDirective(locale: Locale): string {
  const name = { en: "English", fr: "French", es: "Spanish" }[locale];
  return `Reply in ${name}. Use the vocabulary a small-business owner would use, not marketing jargon.`;
}

/** Every key, for the completeness test and the locale emitter. */
export const MESSAGE_KEYS = Object.keys(en) as MessageKey[];

export { LOCALES, DEFAULT_LOCALE, isLocale };
export type { Locale };
