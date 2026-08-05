/**
 * Testimonials.
 *
 * Every row here is entered by Grace. Nothing in this codebase generates, seeds or
 * suggests a testimonial: an unpublished table is the correct state for a new site.
 */
import type { Testimonial } from "@delices/core";
import { id } from "@delices/core";
import { bool, int, nowIso, str, strOrNull, text, toBool, type Db, type Row } from "./db.js";

const toTestimonial = (row: Row): Testimonial => ({
  id: str(row, "id"),
  customerName: str(row, "customer_name"),
  body: str(row, "body"),
  photoMediaId: strOrNull(row, "photo_media_id"),
  photoUrl: strOrNull(row, "photo_url"),
  productId: strOrNull(row, "product_id"),
  productName: strOrNull(row, "product_name"),
  eventDate: strOrNull(row, "event_date"),
  published: bool(row, "published"),
  sortOrder: int(row, "sort_order"),
  createdAt: str(row, "created_at"),
});

const SELECT = `SELECT t.*, m.url AS photo_url, p.name AS product_name
  FROM testimonials t
  LEFT JOIN media m ON m.id = t.photo_media_id
  LEFT JOIN products p ON p.id = t.product_id`;

export function listTestimonials(db: Db, opts: { publishedOnly?: boolean } = {}): Testimonial[] {
  const where = opts.publishedOnly ? " WHERE t.published = 1" : "";
  return (
    db.prepare(`${SELECT}${where} ORDER BY t.sort_order, t.created_at DESC`).all() as Row[]
  ).map(toTestimonial);
}

export function getTestimonial(db: Db, testimonialId: string): Testimonial | null {
  const row = db.prepare(`${SELECT} WHERE t.id = ?`).get(testimonialId) as Row | undefined;
  return row ? toTestimonial(row) : null;
}

export interface TestimonialInput {
  customerName: string;
  body: string;
  photoMediaId?: string | null;
  productId?: string | null;
  eventDate?: string | null;
  published?: boolean;
  sortOrder?: number;
}

export function createTestimonial(db: Db, input: TestimonialInput): Testimonial {
  const testimonialId = id("tst");
  db.prepare(
    `INSERT INTO testimonials
       (id, customer_name, body, photo_media_id, product_id, event_date, published, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    testimonialId,
    input.customerName,
    input.body,
    text(input.photoMediaId),
    text(input.productId),
    text(input.eventDate),
    toBool(input.published ?? false),
    input.sortOrder ?? 0,
    nowIso(),
  );
  return getTestimonial(db, testimonialId)!;
}

export function updateTestimonial(
  db: Db,
  testimonialId: string,
  input: Partial<TestimonialInput>,
): Testimonial | null {
  const current = getTestimonial(db, testimonialId);
  if (!current) return null;
  db.prepare(
    `UPDATE testimonials SET customer_name = ?, body = ?, photo_media_id = ?, product_id = ?,
       event_date = ?, published = ?, sort_order = ?
     WHERE id = ?`,
  ).run(
    input.customerName ?? current.customerName,
    input.body ?? current.body,
    input.photoMediaId === undefined ? current.photoMediaId : text(input.photoMediaId),
    input.productId === undefined ? current.productId : text(input.productId),
    input.eventDate === undefined ? current.eventDate : text(input.eventDate),
    toBool(input.published ?? current.published),
    input.sortOrder ?? current.sortOrder,
    testimonialId,
  );
  return getTestimonial(db, testimonialId);
}

export function deleteTestimonial(db: Db, testimonialId: string): void {
  db.prepare("DELETE FROM testimonials WHERE id = ?").run(testimonialId);
}
