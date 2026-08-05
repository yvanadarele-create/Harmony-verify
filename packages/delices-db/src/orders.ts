/**
 * Orders — the heart of the system.
 *
 * A standard basket and a custom brief are the same row with a different `kind`, so
 * one queue, one calendar and one customer history cover the whole business.
 *
 * Prices are resolved server-side from the catalogue at the moment of ordering. The
 * browser sends product and option ids, never amounts, and a brief is never priced
 * automatically — `quoted_total` stays null until Grace types a number.
 */
import type {
  CustomRequest,
  CustomRequestDraft,
  FieldError,
  Fulfillment,
  Order,
  OrderDraft,
  OrderEvent,
  OrderItem,
  OrderKind,
  OrderStatus,
  PaymentStatus,
  SelectedOption,
} from "@delices/core";
import { canTransition, id, orderReference, phoneMatchKey } from "@delices/core";
import { getOptionsByIds, getProduct, getCategory } from "./catalogue.js";
import { upsertCustomer, getCustomer } from "./customers.js";
import {
  fromJson,
  int,
  intOrNull,
  nowIso,
  str,
  strOrNull,
  text,
  transaction,
  type Db,
  type Row,
} from "./db.js";

export type OrderResult =
  | { ok: true; order: Order }
  | { ok: false; errors: FieldError[] };

// ------------------------------------------------------------------ mapping

const toItem = (row: Row): OrderItem => ({
  id: str(row, "id"),
  orderId: str(row, "order_id"),
  productId: strOrNull(row, "product_id"),
  productName: str(row, "product_name"),
  categoryName: str(row, "category_name"),
  unitPrice: intOrNull(row, "unit_price"),
  quantity: int(row, "quantity"),
  selectedOptions: fromJson<SelectedOption[]>(row.options_json, []),
  notes: strOrNull(row, "notes"),
});

const toCustomRequest = (row: Row): CustomRequest => ({
  id: str(row, "id"),
  orderId: str(row, "order_id"),
  occasion: str(row, "occasion"),
  servings: intOrNull(row, "servings"),
  shape: strOrNull(row, "shape"),
  flavour: strOrNull(row, "flavour"),
  filling: strOrNull(row, "filling"),
  colours: strOrNull(row, "colours"),
  decoration: strOrNull(row, "decoration"),
  messageOnCake: strOrNull(row, "message_on_cake"),
  inspirationMediaId: strOrNull(row, "inspiration_media_id"),
  inspirationUrl: strOrNull(row, "inspiration_url"),
  requirements: strOrNull(row, "requirements"),
});

const toEvent = (row: Row): OrderEvent => ({
  id: str(row, "id"),
  orderId: str(row, "order_id"),
  fromStatus: strOrNull(row, "from_status") as OrderStatus | null,
  toStatus: str(row, "to_status") as OrderStatus,
  note: strOrNull(row, "note"),
  createdAt: str(row, "created_at"),
});

const toOrder = (row: Row): Order => ({
  id: str(row, "id"),
  reference: str(row, "reference"),
  customerId: str(row, "customer_id"),
  kind: str(row, "kind") as OrderKind,
  status: str(row, "status") as OrderStatus,
  requestedDate: str(row, "requested_date"),
  fulfillment: str(row, "fulfillment") as Fulfillment,
  address: strOrNull(row, "address"),
  deliveryNotes: strOrNull(row, "delivery_notes"),
  customerNotes: strOrNull(row, "customer_notes"),
  internalNotes: strOrNull(row, "internal_notes"),
  quotedTotal: intOrNull(row, "quoted_total"),
  itemsTotal: int(row, "items_total"),
  depositPaid: int(row, "deposit_paid"),
  paymentStatus: str(row, "payment_status") as PaymentStatus,
  createdAt: str(row, "created_at"),
  updatedAt: str(row, "updated_at"),
});

// ------------------------------------------------------------------ reads

export function getOrder(db: Db, orderId: string): Order | null {
  const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId) as Row | undefined;
  return row ? hydrate(db, toOrder(row)) : null;
}

export function getOrderByReference(db: Db, reference: string): Order | null {
  const row = db.prepare("SELECT * FROM orders WHERE reference = ?").get(reference.trim().toUpperCase()) as
    | Row
    | undefined;
  return row ? hydrate(db, toOrder(row)) : null;
}

function hydrate(db: Db, order: Order): Order {
  order.items = (
    db.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY rowid").all(order.id) as Row[]
  ).map(toItem);
  const custom = db
    .prepare(
      `SELECT cr.*, m.url AS inspiration_url FROM custom_requests cr
       LEFT JOIN media m ON m.id = cr.inspiration_media_id
       WHERE cr.order_id = ?`,
    )
    .get(order.id) as Row | undefined;
  order.customRequest = custom ? toCustomRequest(custom) : null;
  order.events = (
    db
      .prepare("SELECT * FROM order_events WHERE order_id = ? ORDER BY created_at, rowid")
      .all(order.id) as Row[]
  ).map(toEvent);
  const customer = getCustomer(db, order.customerId);
  if (customer) order.customer = customer;
  return order;
}

export interface OrderQuery {
  statuses?: readonly OrderStatus[];
  kind?: OrderKind;
  from?: string;
  to?: string;
  customerId?: string;
  search?: string;
  limit?: number;
}

export function listOrders(db: Db, query: OrderQuery = {}): Order[] {
  const clauses: string[] = [];
  const params: Array<string | number | null> = [];
  if (query.statuses && query.statuses.length > 0) {
    clauses.push(`o.status IN (${query.statuses.map(() => "?").join(",")})`);
    params.push(...query.statuses);
  }
  if (query.kind) {
    clauses.push("o.kind = ?");
    params.push(query.kind);
  }
  if (query.from) {
    clauses.push("o.requested_date >= ?");
    params.push(query.from);
  }
  if (query.to) {
    clauses.push("o.requested_date <= ?");
    params.push(query.to);
  }
  if (query.customerId) {
    clauses.push("o.customer_id = ?");
    params.push(query.customerId);
  }
  if (query.search && query.search.trim() !== "") {
    const term = query.search.trim();
    const like = `%${term}%`;
    const digits = term.replace(/\D/g, "");
    // The phone clause is only added when the term actually contains digits —
    // otherwise `LIKE '%%'` would quietly match every customer.
    const parts = ["o.reference LIKE ?", "c.name LIKE ?"];
    params.push(like.toUpperCase(), like);
    if (digits.length >= 3) {
      parts.push("c.phone_key LIKE ?");
      params.push(`%${digits}%`);
    }
    clauses.push(`(${parts.join(" OR ")})`);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Math.max(query.limit ?? 200, 1), 500);
  const rows = db
    .prepare(
      `SELECT o.* FROM orders o JOIN customers c ON c.id = o.customer_id${where}
       ORDER BY o.requested_date ASC, o.created_at ASC LIMIT ?`,
    )
    .all(...params, limit) as Row[];
  return rows.map((row) => hydrate(db, toOrder(row)));
}

// ------------------------------------------------------------------ creation

function insertOrder(
  db: Db,
  input: {
    customerId: string;
    kind: OrderKind;
    requestedDate: string;
    fulfillment: Fulfillment;
    address?: string | null;
    deliveryNotes?: string | null;
    customerNotes?: string | null;
    itemsTotal: number;
  },
): string {
  const orderId = id("ord");
  const at = nowIso();
  // A reference collision is astronomically unlikely, but a retry is cheaper than an error.
  let reference = orderReference();
  for (let attempt = 0; attempt < 5; attempt++) {
    const clash = db.prepare("SELECT 1 FROM orders WHERE reference = ?").get(reference);
    if (!clash) break;
    reference = orderReference();
  }
  db.prepare(
    `INSERT INTO orders
       (id, reference, customer_id, kind, status, requested_date, fulfillment, address,
        delivery_notes, customer_notes, internal_notes, quoted_total, items_total,
        deposit_paid, payment_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'NEW', ?, ?, ?, ?, ?, NULL, NULL, ?, 0, 'PENDING', ?, ?)`,
  ).run(
    orderId,
    reference,
    input.customerId,
    input.kind,
    input.requestedDate,
    input.fulfillment,
    text(input.address),
    text(input.deliveryNotes),
    text(input.customerNotes),
    input.itemsTotal,
    at,
    at,
  );
  db.prepare(
    "INSERT INTO order_events (id, order_id, from_status, to_status, note, created_at) VALUES (?, ?, NULL, 'NEW', ?, ?)",
  ).run(id("evt"), orderId, "Demande reçue depuis le site.", at);
  return orderId;
}

/**
 * A standard basket: pizzas, quiches, a listed cake taken as it is.
 *
 * Every line is re-priced from the database. A product whose price is null (a cake
 * that is always quoted) is accepted and simply leaves the order awaiting a quote.
 */
export function createStandardOrder(db: Db, draft: OrderDraft): OrderResult {
  const errors: FieldError[] = [];
  const resolved: Array<{
    productId: string;
    productName: string;
    categoryName: string;
    unitPrice: number | null;
    quantity: number;
    options: SelectedOption[];
    notes: string | null;
  }> = [];

  draft.items.forEach((item, index) => {
    const product = getProduct(db, item.productId);
    if (!product || !product.active) {
      errors.push({ field: `items[${index}].productId`, message: "Ce produit n'est plus disponible." });
      return;
    }
    if (!product.available) {
      errors.push({
        field: `items[${index}].productId`,
        message: `${product.name} n'est pas disponible en ce moment.`,
      });
      return;
    }
    const category = getCategory(db, product.categoryId);
    const requestedOptions = item.selectedOptionIds ?? [];
    const options = getOptionsByIds(db, requestedOptions);
    if (options.length !== requestedOptions.length) {
      errors.push({ field: `items[${index}].selectedOptionIds`, message: "Option inconnue." });
      return;
    }
    const foreign = options.find((option) => option.productId !== product.id || !option.active);
    if (foreign) {
      errors.push({
        field: `items[${index}].selectedOptionIds`,
        message: "Option indisponible pour ce produit.",
      });
      return;
    }
    const missingRequired = (product.options ?? [])
      .filter((option) => option.required && option.active)
      .map((option) => option.groupLabel)
      .filter((group, i, all) => all.indexOf(group) === i)
      .filter((group) => !options.some((chosen) => chosen.groupLabel === group));
    if (missingRequired.length > 0) {
      errors.push({
        field: `items[${index}].selectedOptionIds`,
        message: `Choisissez : ${missingRequired.join(", ")}.`,
      });
      return;
    }

    const deltas = options.reduce((sum, option) => sum + option.priceDelta, 0);
    resolved.push({
      productId: product.id,
      productName: product.name,
      categoryName: category?.name ?? "",
      unitPrice: product.basePrice === null ? null : product.basePrice + deltas,
      quantity: item.quantity,
      options: options.map((option) => ({
        groupLabel: option.groupLabel,
        label: option.label,
        priceDelta: option.priceDelta,
      })),
      notes: item.notes ?? null,
    });
  });

  if (errors.length > 0) return { ok: false, errors };

  const itemsTotal = resolved.reduce(
    (sum, line) => sum + (line.unitPrice ?? 0) * line.quantity,
    0,
  );

  const order = transaction(db, () => {
    const customer = upsertCustomer(db, {
      ...draft.customer,
      address: draft.fulfillment === "delivery" ? draft.address : null,
    });
    const orderId = insertOrder(db, {
      customerId: customer.id,
      kind: "standard",
      requestedDate: draft.requestedDate,
      fulfillment: draft.fulfillment,
      address: draft.address ?? null,
      deliveryNotes: draft.deliveryNotes ?? null,
      customerNotes: draft.customerNotes ?? null,
      itemsTotal,
    });
    const stmt = db.prepare(
      `INSERT INTO order_items
         (id, order_id, product_id, product_name, category_name, unit_price, quantity, options_json, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const line of resolved) {
      stmt.run(
        id("itm"),
        orderId,
        line.productId,
        line.productName,
        line.categoryName,
        line.unitPrice,
        line.quantity,
        JSON.stringify(line.options),
        text(line.notes),
      );
    }
    return getOrder(db, orderId)!;
  });

  return { ok: true, order };
}

/** A custom brief. No price is calculated — that is Grace's call, not the system's. */
export function createCustomOrder(db: Db, draft: CustomRequestDraft): OrderResult {
  const order = transaction(db, () => {
    const customer = upsertCustomer(db, {
      ...draft.customer,
      address: draft.fulfillment === "delivery" ? draft.address : null,
    });
    const orderId = insertOrder(db, {
      customerId: customer.id,
      kind: "custom",
      requestedDate: draft.requestedDate,
      fulfillment: draft.fulfillment,
      address: draft.address ?? null,
      deliveryNotes: draft.deliveryNotes ?? null,
      customerNotes: draft.customerNotes ?? null,
      itemsTotal: 0,
    });
    db.prepare(
      `INSERT INTO custom_requests
         (id, order_id, occasion, servings, shape, flavour, filling, colours, decoration,
          message_on_cake, inspiration_media_id, requirements)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id("req"),
      orderId,
      draft.occasion,
      draft.servings ?? null,
      text(draft.shape),
      text(draft.flavour),
      text(draft.filling),
      text(draft.colours),
      text(draft.decoration),
      text(draft.messageOnCake),
      text(draft.inspirationMediaId),
      text(draft.requirements),
    );
    return getOrder(db, orderId)!;
  });
  return { ok: true, order };
}

// ------------------------------------------------------------------ updates

export function updateOrderStatus(
  db: Db,
  orderId: string,
  to: OrderStatus,
  note?: string | null,
): { ok: true; order: Order } | { ok: false; reason: string } {
  const order = getOrder(db, orderId);
  if (!order) return { ok: false, reason: "Commande introuvable." };
  if (order.status === to) return { ok: true, order };
  if (!canTransition(order.status, to)) {
    return {
      ok: false,
      reason: `Passage impossible de ${order.status} à ${to}.`,
    };
  }
  const at = nowIso();
  transaction(db, () => {
    db.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?").run(to, at, orderId);
    db.prepare(
      "INSERT INTO order_events (id, order_id, from_status, to_status, note, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(id("evt"), orderId, order.status, to, text(note), at);
  });
  return { ok: true, order: getOrder(db, orderId)! };
}

export interface OrderPatch {
  requestedDate?: string;
  fulfillment?: Fulfillment;
  address?: string | null;
  deliveryNotes?: string | null;
  internalNotes?: string | null;
  quotedTotal?: number | null;
  depositPaid?: number;
  paymentStatus?: PaymentStatus;
}

export function updateOrder(db: Db, orderId: string, patch: OrderPatch): Order | null {
  const current = getOrder(db, orderId);
  if (!current) return null;
  const pick = <T>(next: T | undefined, fallback: T): T => (next === undefined ? fallback : next);
  db.prepare(
    `UPDATE orders SET requested_date = ?, fulfillment = ?, address = ?, delivery_notes = ?,
       internal_notes = ?, quoted_total = ?, deposit_paid = ?, payment_status = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    pick(patch.requestedDate, current.requestedDate),
    pick(patch.fulfillment, current.fulfillment),
    patch.address === undefined ? current.address : text(patch.address),
    patch.deliveryNotes === undefined ? current.deliveryNotes : text(patch.deliveryNotes),
    patch.internalNotes === undefined ? current.internalNotes : text(patch.internalNotes),
    pick(patch.quotedTotal, current.quotedTotal),
    pick(patch.depositPaid, current.depositPaid),
    pick(patch.paymentStatus, current.paymentStatus),
    nowIso(),
    orderId,
  );
  return getOrder(db, orderId);
}

/** Grace can add, reprice or drop a line while an order is still open. */
export function addOrderItem(
  db: Db,
  orderId: string,
  line: {
    productName: string;
    categoryName?: string;
    unitPrice: number | null;
    quantity: number;
    notes?: string | null;
    productId?: string | null;
  },
): Order | null {
  if (!getOrder(db, orderId)) return null;
  db.prepare(
    `INSERT INTO order_items
       (id, order_id, product_id, product_name, category_name, unit_price, quantity, options_json, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?)`,
  ).run(
    id("itm"),
    orderId,
    line.productId ?? null,
    line.productName,
    line.categoryName ?? "",
    line.unitPrice,
    line.quantity,
    text(line.notes),
  );
  recalculateItemsTotal(db, orderId);
  return getOrder(db, orderId);
}

export function removeOrderItem(db: Db, orderId: string, itemId: string): Order | null {
  db.prepare("DELETE FROM order_items WHERE id = ? AND order_id = ?").run(itemId, orderId);
  recalculateItemsTotal(db, orderId);
  return getOrder(db, orderId);
}

function recalculateItemsTotal(db: Db, orderId: string): void {
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(COALESCE(unit_price, 0) * quantity), 0) AS total FROM order_items WHERE order_id = ?",
    )
    .get(orderId) as Row;
  db.prepare("UPDATE orders SET items_total = ?, updated_at = ? WHERE id = ?").run(
    Number(row.total ?? 0),
    nowIso(),
    orderId,
  );
}

// ------------------------------------------------------------------ views

export interface DayLoad {
  date: string;
  orders: number;
  items: number;
  customOrders: number;
  deliveries: number;
}

/**
 * Orders per day. Used to spot the heavy days — it does not cap anything, because
 * whether a Saturday with four wedding cakes is full is Grace's judgement, not a
 * constant in a config file.
 */
export function calendar(db: Db, from: string, to: string): DayLoad[] {
  const rows = db
    .prepare(
      `SELECT o.requested_date AS date,
              COUNT(*) AS orders,
              COALESCE(SUM((SELECT COALESCE(SUM(quantity),0) FROM order_items i WHERE i.order_id = o.id)), 0) AS items,
              SUM(CASE WHEN o.kind = 'custom' THEN 1 ELSE 0 END) AS custom_orders,
              SUM(CASE WHEN o.fulfillment = 'delivery' THEN 1 ELSE 0 END) AS deliveries
       FROM orders o
       WHERE o.requested_date BETWEEN ? AND ? AND o.status != 'CANCELLED'
       GROUP BY o.requested_date ORDER BY o.requested_date`,
    )
    .all(from, to) as Row[];
  return rows.map((row) => ({
    date: str(row, "date"),
    orders: int(row, "orders"),
    items: int(row, "items"),
    customOrders: int(row, "custom_orders"),
    deliveries: int(row, "deliveries"),
  }));
}

export interface DashboardStats {
  ordersToday: number;
  pendingRequests: number;
  confirmed: number;
  inProduction: number;
  ready: number;
  deliveriesToday: number;
  completedThisMonth: number;
  revenueThisMonth: number;
  awaitingQuote: number;
  newAppointments: number;
  lowStock: number;
  unreadNotifications: number;
}

export function dashboardStats(db: Db, today: string): DashboardStats {
  const count = (sql: string, ...params: Array<string | number>): number =>
    Number((db.prepare(sql).get(...params) as Row).n ?? 0);
  const month = today.slice(0, 7);
  const revenueRow = db
    .prepare(
      `SELECT COALESCE(SUM(COALESCE(quoted_total, items_total)), 0) AS total FROM orders
       WHERE status = 'COMPLETED' AND substr(requested_date, 1, 7) = ?`,
    )
    .get(month) as Row;

  return {
    ordersToday: count("SELECT COUNT(*) AS n FROM orders WHERE requested_date = ? AND status != 'CANCELLED'", today),
    pendingRequests: count("SELECT COUNT(*) AS n FROM orders WHERE status IN ('NEW','REVIEWING')"),
    confirmed: count("SELECT COUNT(*) AS n FROM orders WHERE status IN ('CONFIRMED','DEPOSIT_PAID')"),
    inProduction: count("SELECT COUNT(*) AS n FROM orders WHERE status = 'IN_PRODUCTION'"),
    ready: count("SELECT COUNT(*) AS n FROM orders WHERE status = 'READY'"),
    deliveriesToday: count(
      "SELECT COUNT(*) AS n FROM orders WHERE fulfillment = 'delivery' AND requested_date = ? AND status NOT IN ('CANCELLED','COMPLETED')",
      today,
    ),
    completedThisMonth: count(
      "SELECT COUNT(*) AS n FROM orders WHERE status = 'COMPLETED' AND substr(requested_date, 1, 7) = ?",
      month,
    ),
    revenueThisMonth: Number(revenueRow.total ?? 0),
    awaitingQuote: count("SELECT COUNT(*) AS n FROM orders WHERE status = 'QUOTE_SENT'"),
    newAppointments: count("SELECT COUNT(*) AS n FROM appointments WHERE status = 'NEW'"),
    lowStock: count("SELECT COUNT(*) AS n FROM inventory_items WHERE quantity <= minimum_stock"),
    unreadNotifications: count(
      "SELECT COUNT(*) AS n FROM notifications WHERE audience = 'owner' AND read_at IS NULL",
    ),
  };
}

/** Tracking is deliberately narrow: a reference plus the phone that placed it. */
export function findOrderForTracking(db: Db, reference: string, phone: string): Order | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return null;
  const suffix = phoneMatchKey(phone);
  const row = db
    .prepare(
      `SELECT o.* FROM orders o JOIN customers c ON c.id = o.customer_id
       WHERE o.reference = ? AND (c.phone_key = ? OR c.phone_key LIKE ?)`,
    )
    .get(reference.trim().toUpperCase(), digits, `%${suffix}`) as Row | undefined;
  return row ? hydrate(db, toOrder(row)) : null;
}

export const orderIsPriced = (order: Order): boolean =>
  order.quotedTotal !== null || (order.kind === "standard" && order.itemsTotal > 0);
