/**
 * The order lifecycle (§45, §46).
 *
 *   quote → pending approval → confirmed → supplier processing → shipped
 *         → in transit → delivered
 *
 * §45 contains a line that shapes this whole module: *do not make automatic
 * supplier purchasing the default until the system has been tested.* So there is
 * no transition into `supplier-processing` that a customer action can trigger.
 * Money leaves Brandora only when an admin moves it, and the state machine is
 * where that is guaranteed — a rule enforced by a UI is a rule one refactor away
 * from being gone.
 *
 * Every transition is recorded with its actor. When a founder asks why their
 * order sat for three days, the history answers without anyone guessing.
 */

import {
  type Money,
  type Order,
  type OrderEvent,
  type OrderStatus,
  ValidationError,
  newId,
} from "@brandora/shared";

/** Legal moves. Anything absent here is a bug, not an edge case. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  quote: ["pending-approval", "cancelled"],
  "pending-approval": ["confirmed", "cancelled"],
  confirmed: ["supplier-processing", "cancelled"],
  "supplier-processing": ["shipped", "cancelled"],
  shipped: ["in-transit", "delivered"],
  "in-transit": ["delivered"],
  delivered: [],
  cancelled: [],
};

/**
 * Transitions only an admin may make.
 *
 * `supplier-processing` is the one that spends money; the two shipping states
 * and delivery are operational facts an admin or a supplier webhook records, not
 * something a customer asserts about their own order.
 */
export const ADMIN_ONLY: readonly OrderStatus[] = [
  "supplier-processing",
  "shipped",
  "in-transit",
  "delivered",
];

export type Actor = { kind: "customer"; userId: string } | { kind: "admin"; userId: string } | { kind: "system"; name: string };

const actorLabel = (actor: Actor): string =>
  actor.kind === "system" ? `system:${actor.name}` : `${actor.kind}:${actor.userId}`;

export interface CreateOrderOptions {
  quoteId: string;
  brandId: string;
  userId: string;
  addressId: string;
  total: Money;
  now?: Date;
}

export function createOrder(options: CreateOrderOptions): Order {
  const now = options.now ?? new Date();
  const timestamp = now.toISOString();
  return {
    id: newId("order"),
    quoteId: options.quoteId,
    brandId: options.brandId,
    userId: options.userId,
    addressId: options.addressId,
    status: "quote",
    total: options.total,
    history: [{ at: timestamp, status: "quote", actor: "system:order-created" }],
    createdAt: timestamp,
    lastUpdate: timestamp,
  };
}

export interface TransitionOptions {
  note?: string;
  now?: Date;
  /** Recorded when moving to `supplier-processing`. */
  supplierOrderId?: string;
  trackingNumber?: string;
  carrier?: string;
  shippingStatus?: string;
}

export function transitionOrder(
  order: Order,
  to: OrderStatus,
  actor: Actor,
  options: TransitionOptions = {},
): Order {
  const allowed = ORDER_TRANSITIONS[order.status];
  if (!allowed.includes(to)) {
    throw new ValidationError("status", `an order cannot go from ${order.status} to ${to}`);
  }
  if (ADMIN_ONLY.includes(to) && actor.kind === "customer") {
    throw new ValidationError("actor", `only an admin or the system may move an order to ${to}`);
  }
  // Shipping without a tracking number leaves the customer with a status and no
  // way to act on it, and §46 stores tracking for exactly this moment.
  if (to === "shipped" && !options.trackingNumber && !order.trackingNumber) {
    throw new ValidationError("trackingNumber", "an order cannot be marked shipped without a tracking number");
  }
  if (to === "supplier-processing" && !options.supplierOrderId && !order.supplierOrderId) {
    throw new ValidationError("supplierOrderId", "record the supplier order id when placing the order");
  }

  const now = options.now ?? new Date();
  const event: OrderEvent = {
    at: now.toISOString(),
    status: to,
    note: options.note,
    actor: actorLabel(actor),
  };

  return {
    ...order,
    status: to,
    supplierOrderId: options.supplierOrderId ?? order.supplierOrderId,
    trackingNumber: options.trackingNumber ?? order.trackingNumber,
    carrier: options.carrier ?? order.carrier,
    shippingStatus: options.shippingStatus ?? order.shippingStatus,
    history: [...order.history, event],
    lastUpdate: now.toISOString(),
  };
}

/** Whether an order can still be cancelled — true until it has left the supplier. */
export const isCancellable = (order: Order): boolean =>
  ORDER_TRANSITIONS[order.status].includes("cancelled");

/** Progress for the tracking bar, 0–1. Cancelled reports its own last position. */
export function orderProgress(order: Order): number {
  const path: OrderStatus[] = [
    "quote",
    "pending-approval",
    "confirmed",
    "supplier-processing",
    "shipped",
    "in-transit",
    "delivered",
  ];
  if (order.status === "cancelled") {
    const last = [...order.history].reverse().find((e) => e.status !== "cancelled");
    const index = last ? path.indexOf(last.status) : 0;
    return index <= 0 ? 0 : index / (path.length - 1);
  }
  const index = path.indexOf(order.status);
  return index < 0 ? 0 : index / (path.length - 1);
}

/**
 * What to tell the customer next (§54).
 *
 * Returns a notification key rather than a sentence, so the message translates
 * (§23) and so the same transition never produces two different wordings in two
 * places.
 */
export function notificationFor(status: OrderStatus): string | null {
  switch (status) {
    case "pending-approval":
      return "notify.quote.ready";
    case "confirmed":
    case "supplier-processing":
      return "notify.order.confirmed";
    case "shipped":
      return "notify.order.shipped";
    case "delivered":
      return "notify.order.delivered";
    default:
      return null;
  }
}
