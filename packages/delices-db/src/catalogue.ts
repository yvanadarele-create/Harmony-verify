/**
 * The catalogue: categories, products, options and media.
 *
 * The catalogue is small — a few dozen products at most — so reads load options and
 * images with the product rather than making the caller ask twice. If it ever grows
 * past that, the join is the thing to split, not the shape of the API.
 */
import type {
  Category,
  CategoryKind,
  MediaAsset,
  OptionKind,
  Product,
  ProductOption,
} from "@delices/core";
import { id, slugify } from "@delices/core";
import {
  bool,
  int,
  intOrNull,
  nowIso,
  str,
  strOrNull,
  text,
  toBool,
  type Db,
  type Row,
} from "./db.js";

// ------------------------------------------------------------------ categories

const toCategory = (row: Row): Category => ({
  id: str(row, "id"),
  slug: str(row, "slug"),
  name: str(row, "name"),
  description: strOrNull(row, "description"),
  kind: str(row, "kind") as CategoryKind,
  sortOrder: int(row, "sort_order"),
  active: bool(row, "active"),
});

export function listCategories(db: Db, opts: { activeOnly?: boolean } = {}): Category[] {
  const sql = opts.activeOnly
    ? "SELECT * FROM categories WHERE active = 1 ORDER BY sort_order, name"
    : "SELECT * FROM categories ORDER BY sort_order, name";
  return (db.prepare(sql).all() as Row[]).map(toCategory);
}

export function getCategoryBySlug(db: Db, slug: string): Category | null {
  const row = db.prepare("SELECT * FROM categories WHERE slug = ?").get(slug) as Row | undefined;
  return row ? toCategory(row) : null;
}

export function getCategory(db: Db, categoryId: string): Category | null {
  const row = db.prepare("SELECT * FROM categories WHERE id = ?").get(categoryId) as Row | undefined;
  return row ? toCategory(row) : null;
}

export interface CategoryInput {
  name: string;
  slug?: string;
  description?: string | null;
  kind?: CategoryKind;
  sortOrder?: number;
  active?: boolean;
}

export function createCategory(db: Db, input: CategoryInput): Category {
  const categoryId = id("cat");
  db.prepare(
    `INSERT INTO categories (id, slug, name, description, kind, sort_order, active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    categoryId,
    uniqueSlug(db, "categories", input.slug || slugify(input.name)),
    input.name,
    text(input.description),
    input.kind ?? "standard",
    input.sortOrder ?? 0,
    toBool(input.active ?? true),
  );
  return getCategory(db, categoryId)!;
}

export function updateCategory(db: Db, categoryId: string, input: Partial<CategoryInput>): Category | null {
  const current = getCategory(db, categoryId);
  if (!current) return null;
  db.prepare(
    `UPDATE categories SET name = ?, description = ?, kind = ?, sort_order = ?, active = ?
     WHERE id = ?`,
  ).run(
    input.name ?? current.name,
    input.description === undefined ? current.description : text(input.description),
    input.kind ?? current.kind,
    input.sortOrder ?? current.sortOrder,
    toBool(input.active ?? current.active),
    categoryId,
  );
  return getCategory(db, categoryId);
}

/** Refuses to delete a category that still holds products — the products come first. */
export function deleteCategory(db: Db, categoryId: string): { ok: boolean; reason?: string } {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM products WHERE category_id = ?")
    .get(categoryId) as Row;
  if (Number(row.n) > 0) {
    return { ok: false, reason: "Cette catégorie contient encore des produits." };
  }
  db.prepare("DELETE FROM categories WHERE id = ?").run(categoryId);
  return { ok: true };
}

function uniqueSlug(db: Db, table: "categories" | "products", desired: string): string {
  const base = slugify(desired);
  let candidate = base;
  let n = 2;
  const stmt = db.prepare(`SELECT 1 FROM ${table} WHERE slug = ?`);
  while (stmt.get(candidate)) {
    candidate = `${base}-${n++}`;
  }
  return candidate;
}

// ------------------------------------------------------------------ options

const toOption = (row: Row): ProductOption => ({
  id: str(row, "id"),
  productId: strOrNull(row, "product_id"),
  kind: str(row, "kind") as OptionKind,
  groupLabel: str(row, "group_label"),
  label: str(row, "label"),
  priceDelta: int(row, "price_delta"),
  servings: intOrNull(row, "servings"),
  required: bool(row, "required"),
  multiple: bool(row, "multiple"),
  sortOrder: int(row, "sort_order"),
  active: bool(row, "active"),
});

export interface OptionInput {
  productId?: string | null;
  kind: OptionKind;
  groupLabel: string;
  label: string;
  priceDelta?: number;
  servings?: number | null;
  required?: boolean;
  multiple?: boolean;
  sortOrder?: number;
  active?: boolean;
}

export function createOption(db: Db, input: OptionInput): ProductOption {
  const optionId = id("opt");
  db.prepare(
    `INSERT INTO product_options
       (id, product_id, kind, group_label, label, price_delta, servings, required, multiple, sort_order, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    optionId,
    input.productId ?? null,
    input.kind,
    input.groupLabel,
    input.label,
    input.priceDelta ?? 0,
    input.servings ?? null,
    toBool(input.required ?? false),
    toBool(input.multiple ?? false),
    input.sortOrder ?? 0,
    toBool(input.active ?? true),
  );
  return getOption(db, optionId)!;
}

export function getOption(db: Db, optionId: string): ProductOption | null {
  const row = db.prepare("SELECT * FROM product_options WHERE id = ?").get(optionId) as
    | Row
    | undefined;
  return row ? toOption(row) : null;
}

export function updateOption(db: Db, optionId: string, input: Partial<OptionInput>): ProductOption | null {
  const current = getOption(db, optionId);
  if (!current) return null;
  db.prepare(
    `UPDATE product_options SET kind = ?, group_label = ?, label = ?, price_delta = ?,
       servings = ?, required = ?, multiple = ?, sort_order = ?, active = ?
     WHERE id = ?`,
  ).run(
    input.kind ?? current.kind,
    input.groupLabel ?? current.groupLabel,
    input.label ?? current.label,
    input.priceDelta ?? current.priceDelta,
    input.servings === undefined ? current.servings : input.servings,
    toBool(input.required ?? current.required),
    toBool(input.multiple ?? current.multiple),
    input.sortOrder ?? current.sortOrder,
    toBool(input.active ?? current.active),
    optionId,
  );
  return getOption(db, optionId);
}

export function deleteOption(db: Db, optionId: string): void {
  db.prepare("DELETE FROM product_options WHERE id = ?").run(optionId);
}

export function listProductOptions(db: Db, productId: string, activeOnly = false): ProductOption[] {
  const sql = activeOnly
    ? "SELECT * FROM product_options WHERE product_id = ? AND active = 1 ORDER BY sort_order, label"
    : "SELECT * FROM product_options WHERE product_id = ? ORDER BY sort_order, label";
  return (db.prepare(sql).all(productId) as Row[]).map(toOption);
}

/**
 * The global choice lists behind the custom-cake brief. `product_id IS NULL` is what
 * makes an option global; the admin edits these on the same screen as product options.
 */
export function listGlobalOptions(db: Db, opts: { kind?: OptionKind; activeOnly?: boolean } = {}): ProductOption[] {
  const clauses = ["product_id IS NULL"];
  const params: Array<string | number | null> = [];
  if (opts.kind) {
    clauses.push("kind = ?");
    params.push(opts.kind);
  }
  if (opts.activeOnly) clauses.push("active = 1");
  const rows = db
    .prepare(`SELECT * FROM product_options WHERE ${clauses.join(" AND ")} ORDER BY kind, sort_order, label`)
    .all(...params) as Row[];
  return rows.map(toOption);
}

export function getOptionsByIds(db: Db, ids: readonly string[]): ProductOption[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT * FROM product_options WHERE id IN (${placeholders})`)
    .all(...ids) as Row[];
  return rows.map(toOption);
}

// ------------------------------------------------------------------ media

const toMedia = (row: Row): MediaAsset => ({
  id: str(row, "id"),
  filename: str(row, "filename"),
  url: str(row, "url"),
  alt: strOrNull(row, "alt"),
  mimeType: str(row, "mime_type"),
  byteSize: int(row, "byte_size"),
  createdAt: str(row, "created_at"),
});

export function createMedia(
  db: Db,
  input: {
    filename: string;
    url: string;
    mimeType: string;
    byteSize: number;
    alt?: string | null;
    source?: "gallery" | "inspiration";
  },
): MediaAsset {
  const mediaId = id("med");
  db.prepare(
    `INSERT INTO media (id, filename, url, alt, mime_type, byte_size, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    mediaId,
    input.filename,
    input.url,
    text(input.alt),
    input.mimeType,
    input.byteSize,
    input.source ?? "gallery",
    nowIso(),
  );
  return getMedia(db, mediaId)!;
}

export function getMedia(db: Db, mediaId: string): MediaAsset | null {
  const row = db.prepare("SELECT * FROM media WHERE id = ?").get(mediaId) as Row | undefined;
  return row ? toMedia(row) : null;
}

export function listMedia(db: Db, source: "gallery" | "inspiration" = "gallery"): MediaAsset[] {
  return (
    db
      .prepare("SELECT * FROM media WHERE source = ? ORDER BY created_at DESC")
      .all(source) as Row[]
  ).map(toMedia);
}

export function updateMediaAlt(db: Db, mediaId: string, alt: string | null): MediaAsset | null {
  db.prepare("UPDATE media SET alt = ? WHERE id = ?").run(text(alt), mediaId);
  return getMedia(db, mediaId);
}

export function deleteMedia(db: Db, mediaId: string): void {
  db.prepare("DELETE FROM media WHERE id = ?").run(mediaId);
}

export function listProductMedia(db: Db, productId: string): MediaAsset[] {
  const rows = db
    .prepare(
      `SELECT m.* FROM product_media pm JOIN media m ON m.id = pm.media_id
       WHERE pm.product_id = ? ORDER BY pm.sort_order, m.created_at`,
    )
    .all(productId) as Row[];
  return rows.map(toMedia);
}

/** Replaces a product's gallery in one call — the admin sends the full ordered list. */
export function setProductMedia(db: Db, productId: string, mediaIds: readonly string[]): void {
  db.prepare("DELETE FROM product_media WHERE product_id = ?").run(productId);
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO product_media (product_id, media_id, sort_order) VALUES (?, ?, ?)",
  );
  mediaIds.forEach((mediaId, index) => stmt.run(productId, mediaId, index));
}

// ------------------------------------------------------------------ products

const toProduct = (row: Row): Product => ({
  id: str(row, "id"),
  categoryId: str(row, "category_id"),
  categorySlug: str(row, "category_slug"),
  slug: str(row, "slug"),
  name: str(row, "name"),
  description: strOrNull(row, "description"),
  ingredients: strOrNull(row, "ingredients"),
  basePrice: intOrNull(row, "base_price"),
  priceFrom: bool(row, "price_from"),
  servings: intOrNull(row, "servings"),
  customisable: bool(row, "customisable"),
  available: bool(row, "available"),
  featured: bool(row, "featured"),
  active: bool(row, "active"),
  sortOrder: int(row, "sort_order"),
  createdAt: str(row, "created_at"),
  updatedAt: str(row, "updated_at"),
});

const PRODUCT_SELECT = `SELECT p.*, c.slug AS category_slug, c.name AS category_name
  FROM products p JOIN categories c ON c.id = p.category_id`;

export interface ProductQuery {
  categorySlug?: string;
  activeOnly?: boolean;
  featuredOnly?: boolean;
  search?: string;
}

export function listProducts(db: Db, query: ProductQuery = {}): Product[] {
  const clauses: string[] = [];
  const params: Array<string | number | null> = [];
  if (query.categorySlug) {
    clauses.push("c.slug = ?");
    params.push(query.categorySlug);
  }
  if (query.activeOnly) clauses.push("p.active = 1 AND c.active = 1");
  if (query.featuredOnly) clauses.push("p.featured = 1");
  if (query.search) {
    clauses.push("(p.name LIKE ? OR p.description LIKE ?)");
    params.push(`%${query.search}%`, `%${query.search}%`);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(`${PRODUCT_SELECT}${where} ORDER BY p.sort_order, p.name`)
    .all(...params) as Row[];
  return rows.map((row) => {
    const product = toProduct(row);
    product.media = listProductMedia(db, product.id);
    product.options = listProductOptions(db, product.id, query.activeOnly === true);
    return product;
  });
}

export function getProductBySlug(db: Db, slug: string): Product | null {
  const row = db.prepare(`${PRODUCT_SELECT} WHERE p.slug = ?`).get(slug) as Row | undefined;
  if (!row) return null;
  const product = toProduct(row);
  product.media = listProductMedia(db, product.id);
  product.options = listProductOptions(db, product.id);
  return product;
}

export function getProduct(db: Db, productId: string): Product | null {
  const row = db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(productId) as Row | undefined;
  if (!row) return null;
  const product = toProduct(row);
  product.media = listProductMedia(db, product.id);
  product.options = listProductOptions(db, product.id);
  return product;
}

export interface ProductInput {
  categoryId: string;
  name: string;
  slug?: string;
  description?: string | null;
  ingredients?: string | null;
  basePrice?: number | null;
  priceFrom?: boolean;
  servings?: number | null;
  customisable?: boolean;
  available?: boolean;
  featured?: boolean;
  active?: boolean;
  sortOrder?: number;
}

export function createProduct(db: Db, input: ProductInput): Product {
  const productId = id("prd");
  const at = nowIso();
  db.prepare(
    `INSERT INTO products
       (id, category_id, slug, name, description, ingredients, base_price, price_from,
        servings, customisable, available, featured, active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    productId,
    input.categoryId,
    uniqueSlug(db, "products", input.slug || input.name),
    input.name,
    text(input.description),
    text(input.ingredients),
    input.basePrice ?? null,
    toBool(input.priceFrom ?? false),
    input.servings ?? null,
    toBool(input.customisable ?? false),
    toBool(input.available ?? true),
    toBool(input.featured ?? false),
    toBool(input.active ?? true),
    input.sortOrder ?? 0,
    at,
    at,
  );
  return getProduct(db, productId)!;
}

export function updateProduct(db: Db, productId: string, input: Partial<ProductInput>): Product | null {
  const current = getProduct(db, productId);
  if (!current) return null;
  const pick = <T>(next: T | undefined, fallback: T): T => (next === undefined ? fallback : next);
  db.prepare(
    `UPDATE products SET category_id = ?, name = ?, description = ?, ingredients = ?,
       base_price = ?, price_from = ?, servings = ?, customisable = ?, available = ?,
       featured = ?, active = ?, sort_order = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    pick(input.categoryId, current.categoryId),
    pick(input.name, current.name),
    input.description === undefined ? current.description : text(input.description),
    input.ingredients === undefined ? current.ingredients : text(input.ingredients),
    pick(input.basePrice, current.basePrice),
    toBool(pick(input.priceFrom, current.priceFrom)),
    pick(input.servings, current.servings),
    toBool(pick(input.customisable, current.customisable)),
    toBool(pick(input.available, current.available)),
    toBool(pick(input.featured, current.featured)),
    toBool(pick(input.active, current.active)),
    pick(input.sortOrder, current.sortOrder),
    nowIso(),
    productId,
  );
  return getProduct(db, productId);
}

export function deleteProduct(db: Db, productId: string): void {
  db.prepare("DELETE FROM products WHERE id = ?").run(productId);
}
