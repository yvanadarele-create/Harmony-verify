/**
 * The notification outbox.
 *
 * Messages are composed and stored the moment something happens, then handed to a
 * transport. If no e-mail transport is configured — the normal state on day one —
 * the owner's copy still lands in the admin's notification list, so a request can
 * never be silently lost because SMTP was not set up.
 */
import { id } from "@delices/core";
import { nowIso, str, strOrNull, type Db, type Row } from "./db.js";

export interface NotificationRecord {
  id: string;
  channel: "email" | "internal";
  audience: "customer" | "owner";
  recipient: string;
  subject: string;
  body: string;
  orderId: string | null;
  readAt: string | null;
  sentAt: string | null;
  error: string | null;
  createdAt: string;
}

const toNotification = (row: Row): NotificationRecord => ({
  id: str(row, "id"),
  channel: str(row, "channel") as "email" | "internal",
  audience: str(row, "audience") as "customer" | "owner",
  recipient: str(row, "recipient"),
  subject: str(row, "subject"),
  body: str(row, "body"),
  orderId: strOrNull(row, "order_id"),
  readAt: strOrNull(row, "read_at"),
  sentAt: strOrNull(row, "sent_at"),
  error: strOrNull(row, "error"),
  createdAt: str(row, "created_at"),
});

export function recordNotification(
  db: Db,
  input: {
    channel: "email" | "internal";
    audience: "customer" | "owner";
    recipient: string;
    subject: string;
    body: string;
    orderId?: string | null;
    sentAt?: string | null;
    error?: string | null;
  },
): NotificationRecord {
  const notificationId = id("ntf");
  db.prepare(
    `INSERT INTO notifications
       (id, channel, audience, recipient, subject, body, order_id, read_at, sent_at, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
  ).run(
    notificationId,
    input.channel,
    input.audience,
    input.recipient,
    input.subject,
    input.body,
    input.orderId ?? null,
    input.sentAt ?? null,
    input.error ?? null,
    nowIso(),
  );
  return getNotification(db, notificationId)!;
}

export function getNotification(db: Db, notificationId: string): NotificationRecord | null {
  const row = db.prepare("SELECT * FROM notifications WHERE id = ?").get(notificationId) as
    | Row
    | undefined;
  return row ? toNotification(row) : null;
}

export function listNotifications(
  db: Db,
  opts: { audience?: "customer" | "owner"; limit?: number } = {},
): NotificationRecord[] {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const rows = opts.audience
    ? (db
        .prepare("SELECT * FROM notifications WHERE audience = ? ORDER BY created_at DESC LIMIT ?")
        .all(opts.audience, limit) as Row[])
    : (db.prepare("SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?").all(limit) as Row[]);
  return rows.map(toNotification);
}

/** Records the outcome of a delivery attempt: a timestamp, or the reason it failed. */
export function markNotificationSent(db: Db, notificationId: string, error: string | null): void {
  db.prepare("UPDATE notifications SET sent_at = ?, error = ? WHERE id = ?").run(
    error ? null : nowIso(),
    error,
    notificationId,
  );
}

export function markNotificationRead(db: Db, notificationId: string): void {
  db.prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL").run(
    nowIso(),
    notificationId,
  );
}

export function markAllNotificationsRead(db: Db): void {
  db.prepare("UPDATE notifications SET read_at = ? WHERE audience = 'owner' AND read_at IS NULL").run(
    nowIso(),
  );
}
