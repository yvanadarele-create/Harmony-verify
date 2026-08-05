/**
 * "Prendre rendez-vous" — the conversation that precedes a wedding cake, a large
 * order or a catering job. It lands in the same admin as everything else.
 */
import type { Appointment, AppointmentDraft, AppointmentStatus } from "@delices/core";
import { id } from "@delices/core";
import { nowIso, str, strOrNull, text, type Db, type Row } from "./db.js";
import { upsertCustomer } from "./customers.js";

const toAppointment = (row: Row): Appointment => ({
  id: str(row, "id"),
  customerId: strOrNull(row, "customer_id"),
  name: str(row, "name"),
  phone: str(row, "phone"),
  whatsapp: strOrNull(row, "whatsapp"),
  email: strOrNull(row, "email"),
  preferredDate: strOrNull(row, "preferred_date"),
  preferredTime: strOrNull(row, "preferred_time"),
  reason: str(row, "reason"),
  message: strOrNull(row, "message"),
  status: str(row, "status") as AppointmentStatus,
  internalNotes: strOrNull(row, "internal_notes"),
  createdAt: str(row, "created_at"),
});

export function createAppointment(db: Db, draft: AppointmentDraft): Appointment {
  // Booking a call makes someone a customer of record — the same person who will
  // later place the order, matched on the same phone number.
  const customer = upsertCustomer(db, {
    name: draft.name,
    phone: draft.phone,
    whatsapp: draft.whatsapp ?? null,
    email: draft.email ?? null,
  });
  const appointmentId = id("apt");
  db.prepare(
    `INSERT INTO appointments
       (id, customer_id, name, phone, whatsapp, email, preferred_date, preferred_time,
        reason, message, status, internal_notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', NULL, ?)`,
  ).run(
    appointmentId,
    customer.id,
    draft.name.trim(),
    draft.phone.trim(),
    text(draft.whatsapp),
    text(draft.email),
    text(draft.preferredDate),
    text(draft.preferredTime),
    draft.reason.trim(),
    text(draft.message),
    nowIso(),
  );
  return getAppointment(db, appointmentId)!;
}

export function getAppointment(db: Db, appointmentId: string): Appointment | null {
  const row = db.prepare("SELECT * FROM appointments WHERE id = ?").get(appointmentId) as
    | Row
    | undefined;
  return row ? toAppointment(row) : null;
}

export function listAppointments(db: Db, status?: AppointmentStatus): Appointment[] {
  const rows = status
    ? (db
        .prepare("SELECT * FROM appointments WHERE status = ? ORDER BY created_at DESC")
        .all(status) as Row[])
    : (db.prepare("SELECT * FROM appointments ORDER BY created_at DESC").all() as Row[]);
  return rows.map(toAppointment);
}

export function updateAppointment(
  db: Db,
  appointmentId: string,
  patch: { status?: AppointmentStatus; internalNotes?: string | null; preferredDate?: string | null; preferredTime?: string | null },
): Appointment | null {
  const current = getAppointment(db, appointmentId);
  if (!current) return null;
  db.prepare(
    `UPDATE appointments SET status = ?, internal_notes = ?, preferred_date = ?, preferred_time = ?
     WHERE id = ?`,
  ).run(
    patch.status ?? current.status,
    patch.internalNotes === undefined ? current.internalNotes : text(patch.internalNotes),
    patch.preferredDate === undefined ? current.preferredDate : text(patch.preferredDate),
    patch.preferredTime === undefined ? current.preferredTime : text(patch.preferredTime),
    appointmentId,
  );
  return getAppointment(db, appointmentId);
}
