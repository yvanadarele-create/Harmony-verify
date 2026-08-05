/**
 * The order lifecycle.
 *
 * Grace stays in control of every step: the machine says which moves are coherent,
 * it never makes one on its own. Two deliberate looseness decisions:
 *
 *  - DEPOSIT_PAID is optional. A confirmed order can go straight into production for
 *    a regular customer who pays on collection.
 *  - READY can complete directly. Not every delivery goes through OUT_FOR_DELIVERY —
 *    plenty are handed over at the door.
 */
import type { OrderStatus, PaymentStatus, AppointmentStatus } from "./types.js";

export const ORDER_STATUSES: readonly OrderStatus[] = [
  "NEW",
  "REVIEWING",
  "QUOTE_SENT",
  "CONFIRMED",
  "DEPOSIT_PAID",
  "IN_PRODUCTION",
  "READY",
  "OUT_FOR_DELIVERY",
  "COMPLETED",
  "CANCELLED",
];

export const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "PENDING",
  "DEPOSIT_PAID",
  "PARTIALLY_PAID",
  "PAID",
  "REFUNDED",
];

export const APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  "NEW",
  "SCHEDULED",
  "DONE",
  "CANCELLED",
];

const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  NEW: ["REVIEWING", "QUOTE_SENT", "CONFIRMED", "CANCELLED"],
  REVIEWING: ["QUOTE_SENT", "CONFIRMED", "CANCELLED"],
  QUOTE_SENT: ["REVIEWING", "CONFIRMED", "CANCELLED"],
  CONFIRMED: ["DEPOSIT_PAID", "IN_PRODUCTION", "CANCELLED"],
  DEPOSIT_PAID: ["IN_PRODUCTION", "CANCELLED"],
  IN_PRODUCTION: ["READY", "CANCELLED"],
  READY: ["OUT_FOR_DELIVERY", "COMPLETED", "CANCELLED"],
  OUT_FOR_DELIVERY: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === "string" && (PAYMENT_STATUSES as readonly string[]).includes(value);
}

/** The statuses reachable from `status` in one step. */
export function nextStatuses(status: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[status];
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: OrderStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Orders that still need something from Grace — the dashboard's working queue. */
export const OPEN_STATUSES: readonly OrderStatus[] = ORDER_STATUSES.filter(
  (s) => s !== "COMPLETED" && s !== "CANCELLED",
);

const ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  NEW: "Nouvelle demande",
  REVIEWING: "En cours d'étude",
  QUOTE_SENT: "Devis envoyé",
  CONFIRMED: "Confirmée",
  DEPOSIT_PAID: "Acompte reçu",
  IN_PRODUCTION: "En préparation",
  READY: "Prête",
  OUT_FOR_DELIVERY: "En livraison",
  COMPLETED: "Terminée",
  CANCELLED: "Annulée",
};

const PAYMENT_STATUS_LABELS: Readonly<Record<PaymentStatus, string>> = {
  PENDING: "Paiement en attente",
  DEPOSIT_PAID: "Acompte payé",
  PARTIALLY_PAID: "Partiellement payé",
  PAID: "Payé",
  REFUNDED: "Remboursé",
};

const APPOINTMENT_STATUS_LABELS: Readonly<Record<AppointmentStatus, string>> = {
  NEW: "Nouvelle",
  SCHEDULED: "Planifié",
  DONE: "Terminé",
  CANCELLED: "Annulé",
};

export const orderStatusLabel = (s: OrderStatus): string => ORDER_STATUS_LABELS[s];
export const paymentStatusLabel = (s: PaymentStatus): string => PAYMENT_STATUS_LABELS[s];
export const appointmentStatusLabel = (s: AppointmentStatus): string =>
  APPOINTMENT_STATUS_LABELS[s];

/** What the customer is told when they track an order — coarser than the internal view. */
export function customerFacingStatus(status: OrderStatus): string {
  switch (status) {
    case "NEW":
    case "REVIEWING":
      return "Nous étudions votre demande";
    case "QUOTE_SENT":
      return "Devis envoyé — en attente de votre confirmation";
    case "CONFIRMED":
    case "DEPOSIT_PAID":
      return "Commande confirmée";
    case "IN_PRODUCTION":
      return "En préparation dans notre atelier";
    case "READY":
      return "Prête pour le retrait";
    case "OUT_FOR_DELIVERY":
      return "En cours de livraison";
    case "COMPLETED":
      return "Terminée — merci de votre confiance";
    case "CANCELLED":
      return "Annulée";
  }
}
