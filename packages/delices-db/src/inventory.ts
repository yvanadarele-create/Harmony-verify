/**
 * Inventory — a stock cupboard, not a warehouse system.
 *
 * V1 tracks what is on hand and shouts when something drops to its minimum. Recipe-
 * based deduction is deliberately absent; the `product_ingredients` table exists so
 * that adding it later is a feature, not a migration of everything else.
 */
import type { InventoryItem, Supplier } from "@delices/core";
import { id } from "@delices/core";
import { int, intOrNull, nowIso, str, strOrNull, text, type Db, type Row } from "./db.js";

const toSupplier = (row: Row): Supplier => ({
  id: str(row, "id"),
  name: str(row, "name"),
  phone: strOrNull(row, "phone"),
  email: strOrNull(row, "email"),
  notes: strOrNull(row, "notes"),
});

export function listSuppliers(db: Db): Supplier[] {
  return (db.prepare("SELECT * FROM suppliers ORDER BY name").all() as Row[]).map(toSupplier);
}

export function createSupplier(
  db: Db,
  input: { name: string; phone?: string | null; email?: string | null; notes?: string | null },
): Supplier {
  const supplierId = id("sup");
  db.prepare("INSERT INTO suppliers (id, name, phone, email, notes) VALUES (?, ?, ?, ?, ?)").run(
    supplierId,
    input.name,
    text(input.phone),
    text(input.email),
    text(input.notes),
  );
  return toSupplier(db.prepare("SELECT * FROM suppliers WHERE id = ?").get(supplierId) as Row);
}

export function updateSupplier(
  db: Db,
  supplierId: string,
  input: Partial<Omit<Supplier, "id">>,
): Supplier | null {
  const row = db.prepare("SELECT * FROM suppliers WHERE id = ?").get(supplierId) as Row | undefined;
  if (!row) return null;
  const current = toSupplier(row);
  db.prepare("UPDATE suppliers SET name = ?, phone = ?, email = ?, notes = ? WHERE id = ?").run(
    input.name ?? current.name,
    input.phone === undefined ? current.phone : text(input.phone),
    input.email === undefined ? current.email : text(input.email),
    input.notes === undefined ? current.notes : text(input.notes),
    supplierId,
  );
  return toSupplier(db.prepare("SELECT * FROM suppliers WHERE id = ?").get(supplierId) as Row);
}

export function deleteSupplier(db: Db, supplierId: string): void {
  db.prepare("DELETE FROM suppliers WHERE id = ?").run(supplierId);
}

const toItem = (row: Row): InventoryItem => ({
  id: str(row, "id"),
  name: str(row, "name"),
  category: strOrNull(row, "category"),
  quantity: Number(row.quantity ?? 0),
  unit: str(row, "unit"),
  minimumStock: Number(row.minimum_stock ?? 0),
  purchasePrice: intOrNull(row, "purchase_price"),
  supplierId: strOrNull(row, "supplier_id"),
  supplierName: strOrNull(row, "supplier_name"),
  updatedAt: str(row, "updated_at"),
});

const ITEM_SELECT = `SELECT i.*, s.name AS supplier_name FROM inventory_items i
  LEFT JOIN suppliers s ON s.id = i.supplier_id`;

export function listInventory(db: Db, opts: { lowOnly?: boolean } = {}): InventoryItem[] {
  const where = opts.lowOnly ? " WHERE i.quantity <= i.minimum_stock" : "";
  return (db.prepare(`${ITEM_SELECT}${where} ORDER BY i.name`).all() as Row[]).map(toItem);
}

export function getInventoryItem(db: Db, itemId: string): InventoryItem | null {
  const row = db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).get(itemId) as Row | undefined;
  return row ? toItem(row) : null;
}

export interface InventoryInput {
  name: string;
  category?: string | null;
  quantity?: number;
  unit?: string;
  minimumStock?: number;
  purchasePrice?: number | null;
  supplierId?: string | null;
}

export function createInventoryItem(db: Db, input: InventoryInput): InventoryItem {
  const itemId = id("inv");
  db.prepare(
    `INSERT INTO inventory_items
       (id, name, category, quantity, unit, minimum_stock, purchase_price, supplier_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    itemId,
    input.name,
    text(input.category),
    input.quantity ?? 0,
    input.unit ?? "unité",
    input.minimumStock ?? 0,
    input.purchasePrice ?? null,
    text(input.supplierId),
    nowIso(),
  );
  return getInventoryItem(db, itemId)!;
}

export function updateInventoryItem(
  db: Db,
  itemId: string,
  input: Partial<InventoryInput>,
): InventoryItem | null {
  const current = getInventoryItem(db, itemId);
  if (!current) return null;
  const pick = <T>(next: T | undefined, fallback: T): T => (next === undefined ? fallback : next);
  db.prepare(
    `UPDATE inventory_items SET name = ?, category = ?, quantity = ?, unit = ?,
       minimum_stock = ?, purchase_price = ?, supplier_id = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    pick(input.name, current.name),
    input.category === undefined ? current.category : text(input.category),
    pick(input.quantity, current.quantity),
    pick(input.unit, current.unit),
    pick(input.minimumStock, current.minimumStock),
    pick(input.purchasePrice, current.purchasePrice),
    input.supplierId === undefined ? current.supplierId : text(input.supplierId),
    nowIso(),
    itemId,
  );
  return getInventoryItem(db, itemId);
}

export function deleteInventoryItem(db: Db, itemId: string): void {
  db.prepare("DELETE FROM inventory_items WHERE id = ?").run(itemId);
}

/** An item is "low" at or below its minimum — the alert fires before the shelf is bare. */
export const isLow = (item: InventoryItem): boolean => item.quantity <= item.minimumStock;

export function countLowStock(db: Db): number {
  return int(
    db.prepare("SELECT COUNT(*) AS n FROM inventory_items WHERE quantity <= minimum_stock").get() as Row,
    "n",
  );
}
