/**
 * Notifications.
 *
 * Two messages leave the building when a request arrives: an acknowledgement to the
 * customer, and the full brief to Grace. Both are written to the outbox first, so a
 * missing SMTP configuration can never swallow an order — the owner's copy is always
 * visible in the admin.
 *
 * `Transport` is the seam for real delivery (SMTP, WhatsApp) later; V1 ships with a
 * store-only transport.
 */
import type { Order, PublicSettings } from "@delices/core";
import { formatMoney, orderStatusLabel } from "@delices/core";
import { markNotificationSent, recordNotification, type Db } from "@delices/db";

export interface Message {
  subject: string;
  body: string;
}

export interface Transport {
  /** Resolves when the message has been handed off; rejects to record a failure. */
  send(to: string, message: Message): Promise<void>;
  readonly name: string;
}

/** The default: nothing is sent, everything is stored and shown in the admin. */
export const storeOnlyTransport: Transport = {
  name: "store-only",
  async send(): Promise<void> {
    // Intentionally does nothing: the outbox row is the delivery in V1.
  },
};

const line = (label: string, value: string | null | undefined): string =>
  value ? `${label} : ${value}\n` : "";

export function customerAcknowledgement(order: Order, settings: PublicSettings): Message {
  const contact = [settings.phone, settings.whatsapp && `WhatsApp ${settings.whatsapp}`]
    .filter(Boolean)
    .join(" · ");
  return {
    subject: `Votre demande ${order.reference} — ${settings.businessName}`,
    body:
      `Bonjour ${order.customer?.name ?? ""},\n\n` +
      "Merci pour votre demande. Nous avons bien reçu votre commande et nous reviendrons " +
      "vers vous pour confirmer les détails.\n\n" +
      `Référence : ${order.reference}\n` +
      `Date souhaitée : ${order.requestedDate}\n` +
      `${order.fulfillment === "delivery" ? "Livraison" : "Retrait sur place"}\n\n` +
      "Vous pouvez suivre votre demande sur notre site avec cette référence et votre " +
      "numéro de téléphone.\n\n" +
      (contact ? `Pour toute question : ${contact}\n\n` : "") +
      `${settings.businessName}`,
  };
}

export function ownerAlert(order: Order, settings: PublicSettings): Message {
  const customer = order.customer;
  const items = (order.items ?? [])
    .map((item) => {
      const options = item.selectedOptions.map((o) => `${o.groupLabel}: ${o.label}`).join(", ");
      const price =
        item.unitPrice === null ? "à définir" : formatMoney(item.unitPrice, settings.currency, settings.locale);
      return `  • ${item.quantity} × ${item.productName}${options ? ` (${options})` : ""} — ${price}${
        item.notes ? `\n    Note : ${item.notes}` : ""
      }`;
    })
    .join("\n");

  const brief = order.customRequest
    ? "Demande sur mesure\n" +
      line("  Occasion", order.customRequest.occasion) +
      line("  Nombre de parts", order.customRequest.servings?.toString()) +
      line("  Forme", order.customRequest.shape) +
      line("  Parfum", order.customRequest.flavour) +
      line("  Garniture", order.customRequest.filling) +
      line("  Couleurs", order.customRequest.colours) +
      line("  Décoration", order.customRequest.decoration) +
      line("  Message sur le gâteau", order.customRequest.messageOnCake) +
      line("  Inspiration", order.customRequest.inspirationUrl) +
      line("  Précisions", order.customRequest.requirements)
    : "";

  return {
    subject: `${order.kind === "custom" ? "Demande sur mesure" : "Nouvelle commande"} ${order.reference} — ${
      order.requestedDate
    }`,
    body:
      `${orderStatusLabel(order.status)} — reçue le ${order.createdAt.slice(0, 10)}\n\n` +
      `Client : ${customer?.name ?? ""}\n` +
      line("Téléphone", customer?.phone) +
      line("WhatsApp", customer?.whatsapp) +
      line("E-mail", customer?.email) +
      `\nDate souhaitée : ${order.requestedDate}\n` +
      `Mode : ${order.fulfillment === "delivery" ? "Livraison" : "Retrait"}\n` +
      line("Adresse", order.address) +
      line("Notes de livraison", order.deliveryNotes) +
      (items ? `\nProduits :\n${items}\n` : "") +
      (order.itemsTotal > 0
        ? `\nTotal panier : ${formatMoney(order.itemsTotal, settings.currency, settings.locale)}\n`
        : "") +
      (brief ? `\n${brief}` : "") +
      line("\nMessage du client", order.customerNotes),
  };
}

export function appointmentAlert(
  input: { name: string; phone: string; whatsapp?: string | null; email?: string | null; preferredDate?: string | null; preferredTime?: string | null; reason: string; message?: string | null },
): Message {
  return {
    subject: `Demande de rendez-vous — ${input.name}`,
    body:
      `Motif : ${input.reason}\n` +
      line("Téléphone", input.phone) +
      line("WhatsApp", input.whatsapp) +
      line("E-mail", input.email) +
      line("Date souhaitée", input.preferredDate) +
      line("Heure souhaitée", input.preferredTime) +
      line("Message", input.message),
  };
}

/**
 * Stores a message and attempts delivery. Delivery failure is recorded on the row
 * and never propagates: an order must not fail because e-mail is down.
 */
export async function deliver(
  db: Db,
  transport: Transport,
  input: {
    audience: "customer" | "owner";
    recipient: string;
    message: Message;
    orderId?: string | null;
  },
): Promise<void> {
  const channel = input.recipient.includes("@") ? "email" : "internal";
  const record = recordNotification(db, {
    channel,
    audience: input.audience,
    recipient: input.recipient || "—",
    subject: input.message.subject,
    body: input.message.body,
    orderId: input.orderId ?? null,
  });
  if (channel !== "email") return;
  try {
    await transport.send(input.recipient, input.message);
    markNotificationSent(db, record.id, null);
  } catch (error) {
    markNotificationSent(db, record.id, error instanceof Error ? error.message : String(error));
  }
}
