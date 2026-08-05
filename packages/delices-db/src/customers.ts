/**
 * Customers.
 *
 * There is no customer login: a phone number identifies a person. `upsertCustomer`
 * is therefore the single door through which every order and every appointment
 * enters — it matches on the digits of the phone number, falls back to e-mail, and
 * fills in details the customer has given us since last time without ever wiping a
 * value Grace typed by hand.
 */
import type { Customer, CustomerDetails, CustomerSummary } from "@delices/core";
import { id, phoneDigits, phoneMatchKey } from "@delices/core";
import { int, intOrNull, nowIso, str, strOrNull, text, type Db, type Row } from "./db.js";

const toCustomer = (row: Row): Customer => ({
  id: str(row, "id"),
  name: str(row, "name"),
  phone: str(row, "phone"),
  whatsapp: strOrNull(row, "whatsapp"),
  email: strOrNull(row, "email"),
  address: strOrNull(row, "address"),
  preferences: strOrNull(row, "preferences"),
  notes: strOrNull(row, "notes"),
  createdAt: str(row, "created_at"),
  updatedAt: str(row, "updated_at"),
});

const toSummary = (row: Row): CustomerSummary => ({
  ...toCustomer(row),
  totalOrders: int(row, "total_orders"),
  totalSpend: int(row, "total_spend"),
  lastOrderDate: strOrNull(row, "last_order_date"),
});

export function getCustomer(db: Db, customerId: string): Customer | null {
  const row = db.prepare("SELECT * FROM customers WHERE id = ?").get(customerId) as Row | undefined;
  return row ? toCustomer(row) : null;
}

export function findCustomerByPhone(db: Db, phone: string): Customer | null {
  const key = phoneDigits(phone);
  if (!key) return null;
  const row = db.prepare("SELECT * FROM customers WHERE phone_key = ?").get(key) as Row | undefined;
  return row ? toCustomer(row) : null;
}

export function upsertCustomer(
  db: Db,
  details: CustomerDetails & { address?: string | null },
): Customer {
  const phone = details.phone.trim();
  const key = phoneDigits(phone);
  const email = text(details.email);
  const at = nowIso();

  let existing = key
    ? (db.prepare("SELECT * FROM customers WHERE phone_key = ?").get(key) as Row | undefined)
    : undefined;
  // Same person, different way of writing the number: match on the national digits.
  if (!existing && key) {
    const suffix = phoneMatchKey(phone);
    if (suffix.length >= 8) {
      existing = db
        .prepare("SELECT * FROM customers WHERE phone_key LIKE ? ORDER BY created_at LIMIT 1")
        .get(`%${suffix}`) as Row | undefined;
    }
  }
  if (!existing && email) {
    existing = db.prepare("SELECT * FROM customers WHERE email = ?").get(email) as Row | undefined;
  }

  if (existing) {
    const current = toCustomer(existing);
    // Only fill gaps and refresh the name; never blank a field Grace may have curated.
    db.prepare(
      `UPDATE customers SET name = ?, phone = ?, whatsapp = ?, email = ?, address = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      details.name.trim() || current.name,
      phone || current.phone,
      text(details.whatsapp) ?? current.whatsapp,
      email ?? current.email,
      text(details.address) ?? current.address,
      at,
      current.id,
    );
    return getCustomer(db, current.id)!;
  }

  const customerId = id("cus");
  db.prepare(
    `INSERT INTO customers
       (id, name, phone, phone_key, whatsapp, email, address, preferences, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
  ).run(
    customerId,
    details.name.trim(),
    phone,
    key || customerId,
    text(details.whatsapp),
    email,
    text(details.address),
    at,
    at,
  );
  return getCustomer(db, customerId)!;
}

/**
 * Totals are derived from the orders table rather than kept as counters, so they can
 * never drift out of step with reality. Revenue counts what Grace agreed to charge
 * (the quote when there is one, the basket otherwise) on orders that completed.
 */
const SUMMARY_SELECT = `
  SELECT c.*,
    (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS total_orders,
    (SELECT COALESCE(SUM(COALESCE(o.quoted_total, o.items_total)), 0)
       FROM orders o WHERE o.customer_id = c.id AND o.status = 'COMPLETED') AS total_spend,
    (SELECT MAX(o.requested_date) FROM orders o WHERE o.customer_id = c.id) AS last_order_date
  FROM customers c`;

export function listCustomers(db: Db, search?: string): CustomerSummary[] {
  if (search && search.trim() !== "") {
    const like = `%${search.trim()}%`;
    const digits = phoneDigits(search);
    const rows = db
      .prepare(
        `${SUMMARY_SELECT} WHERE c.name LIKE ? OR c.email LIKE ? OR c.phone_key LIKE ?
         ORDER BY c.updated_at DESC`,
      )
      .all(like, like, `%${digits || search.trim()}%`) as Row[];
    return rows.map(toSummary);
  }
  const rows = db.prepare(`${SUMMARY_SELECT} ORDER BY c.updated_at DESC`).all() as Row[];
  return rows.map(toSummary);
}

export function getCustomerSummary(db: Db, customerId: string): CustomerSummary | null {
  const row = db.prepare(`${SUMMARY_SELECT} WHERE c.id = ?`).get(customerId) as Row | undefined;
  return row ? toSummary(row) : null;
}

export function updateCustomer(
  db: Db,
  customerId: string,
  input: Partial<Pick<Customer, "name" | "phone" | "whatsapp" | "email" | "address" | "preferences" | "notes">>,
): Customer | null {
  const current = getCustomer(db, customerId);
  if (!current) return null;
  const phone = input.phone?.trim() || current.phone;
  db.prepare(
    `UPDATE customers SET name = ?, phone = ?, phone_key = ?, whatsapp = ?, email = ?,
       address = ?, preferences = ?, notes = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    input.name?.trim() || current.name,
    phone,
    phoneDigits(phone) || customerId,
    input.whatsapp === undefined ? current.whatsapp : text(input.whatsapp),
    input.email === undefined ? current.email : text(input.email),
    input.address === undefined ? current.address : text(input.address),
    input.preferences === undefined ? current.preferences : text(input.preferences),
    input.notes === undefined ? current.notes : text(input.notes),
    nowIso(),
    customerId,
  );
  return getCustomer(db, customerId);
}

export function countCustomers(db: Db): number {
  return intOrNull(db.prepare("SELECT COUNT(*) AS n FROM customers").get() as Row, "n") ?? 0;
}
