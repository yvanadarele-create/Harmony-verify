/**
 * Request validation.
 *
 * Every message here is customer-facing French, because the same errors are shown
 * next to the field that produced them. Validation runs on the server for every
 * submission — the browser copy is a convenience, never the guard.
 */
import type {
  AppointmentDraft,
  CustomRequestDraft,
  Fulfillment,
  OrderDraft,
  CustomerDetails,
} from "./types.js";

export interface FieldError {
  field: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: FieldError[];
}

const MAX_TEXT = 2000;
const MAX_SHORT = 200;

const isString = (v: unknown): v is string => typeof v === "string";
const trimmed = (v: unknown): string => (isString(v) ? v.trim() : "");

/** Digits only, so "+33 6 12 34 56 78" and "06-12-34-56-78" both count as 10 digits. */
export function phoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * The trailing digits of a number, which is what stays the same when the same person
 * writes "+33 6 12 34 56 78" one day and "06 12 34 56 78" the next. Used to recognise
 * a returning customer and to check an order-tracking request — never on its own as a
 * secret, always alongside the order reference.
 */
export function phoneMatchKey(value: string): string {
  const digits = phoneDigits(value);
  return digits.length > 9 ? digits.slice(-9) : digits;
}

export function isValidPhone(value: string): boolean {
  const digits = phoneDigits(value);
  return digits.length >= 6 && digits.length <= 15 && /^[+()\d\s.-]+$/.test(value);
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 254;
}

/** ISO `YYYY-MM-DD`, and a date that actually exists (rejects 2026-02-31). */
export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  );
}

export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** `today` is injected so the rule is testable and not tied to the machine clock. */
export function isFutureOrToday(value: string, today: string): boolean {
  return value >= today;
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function checkCustomer(customer: unknown, errors: FieldError[], prefix = "customer"): void {
  const c = (customer ?? {}) as Partial<CustomerDetails>;
  const name = trimmed(c.name);
  if (name.length < 2) {
    errors.push({ field: `${prefix}.name`, message: "Merci d'indiquer votre nom." });
  } else if (name.length > MAX_SHORT) {
    errors.push({ field: `${prefix}.name`, message: "Ce nom est trop long." });
  }

  const phone = trimmed(c.phone);
  if (phone === "") {
    errors.push({ field: `${prefix}.phone`, message: "Merci d'indiquer un numéro de téléphone." });
  } else if (!isValidPhone(phone)) {
    errors.push({ field: `${prefix}.phone`, message: "Ce numéro de téléphone n'est pas valide." });
  }

  const whatsapp = trimmed(c.whatsapp);
  if (whatsapp !== "" && !isValidPhone(whatsapp)) {
    errors.push({ field: `${prefix}.whatsapp`, message: "Ce numéro WhatsApp n'est pas valide." });
  }

  const email = trimmed(c.email);
  if (email !== "" && !isValidEmail(email)) {
    errors.push({ field: `${prefix}.email`, message: "Cette adresse e-mail n'est pas valide." });
  }
}

function checkFulfillment(
  fulfillment: unknown,
  address: unknown,
  errors: FieldError[],
): void {
  if (fulfillment !== "pickup" && fulfillment !== "delivery") {
    errors.push({ field: "fulfillment", message: "Choisissez le retrait ou la livraison." });
    return;
  }
  if ((fulfillment as Fulfillment) === "delivery" && trimmed(address).length < 5) {
    errors.push({
      field: "address",
      message: "Une adresse de livraison est nécessaire.",
    });
  }
}

function checkDate(value: unknown, today: string, errors: FieldError[], field = "requestedDate"): void {
  const date = trimmed(value);
  if (date === "") {
    errors.push({ field, message: "Indiquez la date souhaitée." });
  } else if (!isValidDate(date)) {
    errors.push({ field, message: "Cette date n'est pas valide." });
  } else if (!isFutureOrToday(date, today)) {
    errors.push({ field, message: "La date souhaitée est déjà passée." });
  }
}

function checkLength(
  value: unknown,
  field: string,
  max: number,
  errors: FieldError[],
): void {
  if (trimmed(value).length > max) {
    errors.push({ field, message: "Ce texte est trop long." });
  }
}

export function validateOrderDraft(draft: unknown, today: string): ValidationResult {
  const errors: FieldError[] = [];
  const d = (draft ?? {}) as Partial<OrderDraft>;

  checkCustomer(d.customer, errors);
  checkDate(d.requestedDate, today, errors);
  checkFulfillment(d.fulfillment, d.address, errors);
  checkLength(d.customerNotes, "customerNotes", MAX_TEXT, errors);
  checkLength(d.deliveryNotes, "deliveryNotes", MAX_TEXT, errors);
  checkLength(d.address, "address", MAX_TEXT, errors);

  const items = Array.isArray(d.items) ? d.items : [];
  if (items.length === 0) {
    errors.push({ field: "items", message: "Votre commande est vide." });
  } else if (items.length > 50) {
    errors.push({ field: "items", message: "Cette commande contient trop de lignes." });
  }
  items.forEach((item, index) => {
    if (!isString(item?.productId) || item.productId === "") {
      errors.push({ field: `items[${index}].productId`, message: "Produit inconnu." });
    }
    const quantity = Number(item?.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      errors.push({
        field: `items[${index}].quantity`,
        message: "La quantité doit être comprise entre 1 et 99.",
      });
    }
    if (item?.selectedOptionIds !== undefined && !Array.isArray(item.selectedOptionIds)) {
      errors.push({ field: `items[${index}].selectedOptionIds`, message: "Options invalides." });
    }
    checkLength(item?.notes, `items[${index}].notes`, MAX_SHORT, errors);
  });

  return { ok: errors.length === 0, errors };
}

export function validateCustomRequest(draft: unknown, today: string): ValidationResult {
  const errors: FieldError[] = [];
  const d = (draft ?? {}) as Partial<CustomRequestDraft>;

  checkCustomer(d.customer, errors);
  checkDate(d.requestedDate, today, errors);
  checkFulfillment(d.fulfillment, d.address, errors);

  if (trimmed(d.occasion) === "") {
    errors.push({ field: "occasion", message: "Indiquez l'occasion." });
  }
  checkLength(d.occasion, "occasion", MAX_SHORT, errors);

  if (d.servings !== undefined && d.servings !== null && trimmed(String(d.servings)) !== "") {
    const servings = Number(d.servings);
    if (!Number.isInteger(servings) || servings < 1 || servings > 2000) {
      errors.push({
        field: "servings",
        message: "Indiquez un nombre de parts entre 1 et 2000.",
      });
    }
  }

  for (const field of ["shape", "flavour", "filling", "colours", "decoration"] as const) {
    checkLength(d[field], field, MAX_SHORT, errors);
  }
  checkLength(d.messageOnCake, "messageOnCake", MAX_SHORT, errors);
  checkLength(d.requirements, "requirements", MAX_TEXT, errors);
  checkLength(d.customerNotes, "customerNotes", MAX_TEXT, errors);
  checkLength(d.deliveryNotes, "deliveryNotes", MAX_TEXT, errors);
  checkLength(d.address, "address", MAX_TEXT, errors);

  return { ok: errors.length === 0, errors };
}

export function validateAppointment(draft: unknown, today: string): ValidationResult {
  const errors: FieldError[] = [];
  const d = (draft ?? {}) as Partial<AppointmentDraft>;

  checkCustomer(d, errors, "");
  // `checkCustomer` prefixes with "." when the prefix is empty; normalise the names.
  for (const error of errors) error.field = error.field.replace(/^\./, "");

  if (trimmed(d.reason) === "") {
    errors.push({ field: "reason", message: "Indiquez le motif de votre demande." });
  }
  checkLength(d.reason, "reason", MAX_SHORT, errors);
  checkLength(d.message, "message", MAX_TEXT, errors);

  const date = trimmed(d.preferredDate);
  if (date !== "") checkDate(date, today, errors, "preferredDate");

  const time = trimmed(d.preferredTime);
  if (time !== "" && !isValidTime(time)) {
    errors.push({ field: "preferredTime", message: "Indiquez une heure au format 14:30." });
  }

  return { ok: errors.length === 0, errors };
}
