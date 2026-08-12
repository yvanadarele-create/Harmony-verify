import { randomUUID } from "node:crypto";

/**
 * Prefixed identifiers, so an ID is self-describing wherever it surfaces — a log
 * line, a WhatsApp message to a customer, an admin searching for `qte_…`.
 */
const PREFIXES = {
  user: "usr",
  brand: "brn",
  asset: "ast",
  conversation: "cnv",
  message: "msg",
  product: "prd",
  variant: "var",
  supplier: "sup",
  supplierProduct: "sprd",
  package: "pkg",
  packageItem: "pki",
  quote: "qte",
  quoteItem: "qti",
  order: "ord",
  orderItem: "ori",
  payment: "pay",
  address: "adr",
  shipment: "shp",
  notification: "ntf",
  trend: "trd",
} as const;

export type IdKind = keyof typeof PREFIXES;

export function newId(kind: IdKind): string {
  return `${PREFIXES[kind]}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function isId(kind: IdKind, value: string): boolean {
  return value.startsWith(`${PREFIXES[kind]}_`);
}

/**
 * A URL-safe slug for a brand name. Used for asset paths and share links, so it
 * has to survive accents — "Café Lumé" must not collapse to "caf-lum".
 */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
