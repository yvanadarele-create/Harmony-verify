/**
 * Browsing and filtering the catalogue.
 *
 * The quantity filter is the one with teeth. §35 says a product that cannot
 * satisfy the order must not be offered as a primary option — showing a founder
 * a beautiful cup with a 500-unit minimum when they asked for thirty wastes the
 * one thing they have least of. So `filterProducts` separates *matches* from
 * *near misses* rather than silently dropping either.
 */

import type { BrandoraProduct, ProductCategory } from "@brandora/shared";
import { CATALOG } from "./seed.js";

export interface CatalogFilter {
  category?: ProductCategory;
  subcategory?: string;
  /** How many units the customer needs. Drives MOQ and stock filtering. */
  quantity?: number;
  /** Only products that can carry a logo — confirmed, not assumed. */
  customizableOnly?: boolean;
  colors?: string[];
  search?: string;
  featuredOnly?: boolean;
}

export interface FilterResult {
  /** Can actually fulfil the request. */
  matches: BrandoraProduct[];
  /**
   * Right kind of product, wrong quantity. Shown under a heading that says so,
   * because "we have this, but not at thirty" is useful information — and it is
   * how a founder learns that fifty units unlocks a better shelf.
   */
  nearMisses: BrandoraProduct[];
}

const normalise = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

function matchesSearch(product: BrandoraProduct, term: string): boolean {
  const needle = normalise(term);
  return [product.name, product.description, product.subcategory, product.material ?? ""].some(
    (field) => normalise(field).includes(needle),
  );
}

/** True when the product can be ordered at this quantity (§35). */
export function satisfiesQuantity(product: BrandoraProduct, quantity: number): boolean {
  return product.minimumQuantity <= quantity && product.availableQuantity >= quantity;
}

/**
 * Confirmed customisable — `verified` or `reported`, never `unknown` (§36).
 *
 * `reported` is included because a supplier saying so is real evidence; the
 * interface still labels the difference so nobody promises a customer something
 * on a supplier's word alone.
 */
export function isCustomizable(product: BrandoraProduct): boolean {
  return product.customization.confidence === "verified" || product.customization.confidence === "reported";
}

export function filterProducts(
  filter: CatalogFilter = {},
  source: readonly BrandoraProduct[] = CATALOG,
): FilterResult {
  const eligible = source.filter((product) => {
    if (product.status !== "active") return false;
    if (filter.category && product.category !== filter.category) return false;
    if (filter.subcategory && product.subcategory !== filter.subcategory) return false;
    if (filter.featuredOnly && !product.featured) return false;
    if (filter.customizableOnly && !isCustomizable(product)) return false;
    if (filter.colors?.length && !filter.colors.some((c) => product.colors.includes(c))) return false;
    if (filter.search && !matchesSearch(product, filter.search)) return false;
    return true;
  });

  if (filter.quantity === undefined) return { matches: [...eligible], nearMisses: [] };

  const quantity = filter.quantity;
  const matches: BrandoraProduct[] = [];
  const nearMisses: BrandoraProduct[] = [];
  for (const product of eligible) {
    (satisfiesQuantity(product, quantity) ? matches : nearMisses).push(product);
  }
  return { matches, nearMisses };
}

export function productById(
  id: string,
  source: readonly BrandoraProduct[] = CATALOG,
): BrandoraProduct | undefined {
  return source.find((p) => p.id === id);
}

export function categories(source: readonly BrandoraProduct[] = CATALOG): {
  category: ProductCategory;
  subcategories: string[];
  count: number;
}[] {
  const map = new Map<ProductCategory, Set<string>>();
  const counts = new Map<ProductCategory, number>();
  for (const product of source) {
    if (product.status !== "active") continue;
    const set = map.get(product.category) ?? new Set<string>();
    set.add(product.subcategory);
    map.set(product.category, set);
    counts.set(product.category, (counts.get(product.category) ?? 0) + 1);
  }
  return [...map.entries()].map(([category, subs]) => ({
    category,
    subcategories: [...subs].sort(),
    count: counts.get(category) ?? 0,
  }));
}

/**
 * The lowest quantity at which a product becomes orderable.
 *
 * Surfaced next to a near miss so the interface can say "available from 50"
 * instead of just refusing.
 */
export const minimumViableQuantity = (product: BrandoraProduct): number => product.minimumQuantity;
