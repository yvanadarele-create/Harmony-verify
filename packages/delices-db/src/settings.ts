/**
 * Settings.
 *
 * Every phone number, address and opening hour the site shows comes from here, so
 * changing the WhatsApp number is one field in the admin rather than a search across
 * a dozen HTML files.
 */
import type { PublicSettings } from "@delices/core";
import { nowIso, type Db, type Row } from "./db.js";

export const DEFAULT_SETTINGS: Readonly<Record<string, string>> = {
  businessName: "Les Délices de Grace Lumière",
  tagline: "Des créations gourmandes pour tous vos moments.",
  phone: "",
  whatsapp: "",
  email: "",
  address: "",
  hours: "",
  instagram: "",
  facebook: "",
  currency: "EUR",
  locale: "fr-FR",
  leadTimeDays: "3",
  announcement: "",
  ownerNotificationEmail: "",
};

/** Keys the public site is allowed to read. Everything else is admin-only. */
const PUBLIC_KEYS = new Set(Object.keys(DEFAULT_SETTINGS).filter((k) => k !== "ownerNotificationEmail"));

export function getAllSettings(db: Db): Record<string, string> {
  const rows = db.prepare("SELECT key, value FROM settings").all() as Row[];
  const out: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const row of rows) out[String(row.key)] = String(row.value ?? "");
  return out;
}

export function getSetting(db: Db, key: string): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as Row | undefined;
  if (row) return String(row.value ?? "");
  return DEFAULT_SETTINGS[key] ?? "";
}

export function setSettings(db: Db, values: Record<string, string>): void {
  const stmt = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  const at = nowIso();
  for (const [key, value] of Object.entries(values)) {
    stmt.run(key, String(value ?? "").slice(0, 2000), at);
  }
}

export function getPublicSettings(db: Db): PublicSettings {
  const all = getAllSettings(db);
  const pick = (key: string): string => (PUBLIC_KEYS.has(key) ? (all[key] ?? "") : "");
  const leadTime = Number(all.leadTimeDays);
  return {
    businessName: pick("businessName"),
    tagline: pick("tagline"),
    phone: pick("phone"),
    whatsapp: pick("whatsapp"),
    email: pick("email"),
    address: pick("address"),
    hours: pick("hours"),
    instagram: pick("instagram"),
    facebook: pick("facebook"),
    currency: pick("currency") || "EUR",
    locale: pick("locale") || "fr-FR",
    leadTimeDays: Number.isFinite(leadTime) ? leadTime : 3,
    announcement: pick("announcement"),
  };
}
