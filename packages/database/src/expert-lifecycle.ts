import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { newId } from "@harmony/shared";
import type { Expert, Id } from "@harmony/shared";
import { nowIso, orUndefined, type Db } from "./db.js";

/**
 * Expert lifecycle: agreement gate, rating rule, wallet and payouts.
 *
 * Every rule in here is enforced server-side at the point of decision, not shown as a
 * badge and hoped for. `canBeAssigned` is the single gate the matcher must call, and
 * `rateExpert` suspends inside the same transaction that records the rating, so there
 * is no window in which a failing expert keeps receiving work.
 */

/* --- Rating rule -------------------------------------------------------- */

export const MINIMUM_RATING = 2.5;
export const SUSPENSION_REASON = "rating below minimum threshold — lack of seriousness";

export interface RatingInput {
  reviewId: Id;
  expertId: Id;
  /** Each 1–5. The three dimensions the punch list specifies. */
  quality: number;
  deadline: number;
  professionalism: number;
}

export interface RatingResult {
  rating: number;
  ratingCount: number;
  suspended: boolean;
  reason?: string;
}

/**
 * Records a customer's rating and enforces the 2.5 rule in the same transaction.
 *
 * Suspension is applied here rather than in a nightly job or a UI check: between a
 * bad rating and a scheduled sweep, a failing reviewer would keep being assigned
 * cases, which is the exact outcome the rule exists to prevent.
 */
export function rateExpert(db: Db, input: RatingInput): RatingResult {
  for (const [k, v] of [
    ["quality", input.quality],
    ["deadline", input.deadline],
    ["professionalism", input.professionalism],
  ] as const) {
    if (!Number.isInteger(v) || v < 1 || v > 5) {
      throw new Error(`${k} must be an integer from 1 to 5, received ${v}`);
    }
  }

  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO expert_ratings (id, expert_id, review_id, quality, deadline, professionalism, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId("audit"), input.expertId, input.reviewId,
      input.quality, input.deadline, input.professionalism, nowIso(),
    );

    // Rolling average over the three dimensions of every rating on record.
    const row = db
      .prepare(
        `SELECT AVG((quality + deadline + professionalism) / 3.0) AS avg, COUNT(*) AS n
         FROM expert_ratings WHERE expert_id = ?`,
      )
      .get(input.expertId) as { avg: number; n: number };

    const rating = Math.round(row.avg * 100) / 100;
    const ratingCount = Number(row.n);
    const suspended = rating < MINIMUM_RATING;

    if (suspended) {
      db.prepare(
        `UPDATE experts SET rating = ?, rating_count = ?, status = 'suspended', suspension_reason = ?
         WHERE id = ?`,
      ).run(rating, ratingCount, SUSPENSION_REASON, input.expertId);
    } else {
      db.prepare(`UPDATE experts SET rating = ?, rating_count = ? WHERE id = ?`)
        .run(rating, ratingCount, input.expertId);
    }

    db.exec("COMMIT");
    return suspended
      ? { rating, ratingCount, suspended, reason: SUSPENSION_REASON }
      : { rating, ratingCount, suspended };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** Admin override. Clears the reason so the audit trail shows a deliberate act. */
export function reinstateExpert(db: Db, expertId: Id): void {
  db.prepare(`UPDATE experts SET status = 'active', suspension_reason = NULL WHERE id = ?`)
    .run(expertId);
}

/* --- Agreement gate ----------------------------------------------------- */

export interface AgreementSignature {
  expertId: Id;
  /** Stored PDF, or the generated record of an in-app signature. */
  documentUrl: string;
  /** Typed name for an in-app signature; omitted when a signed PDF is uploaded. */
  typedName?: string;
}

export function signAgreement(db: Db, input: AgreementSignature): void {
  if (!input.documentUrl.trim()) throw new Error("agreement document url is required");
  db.prepare(`UPDATE experts SET agreement_signed_url = ?, agreement_signed_at = ? WHERE id = ?`)
    .run(input.documentUrl, nowIso(), input.expertId);
}

export interface AssignmentEligibility {
  eligible: boolean;
  reason?: string;
}

/**
 * The single gate the matcher must pass before assigning any review.
 *
 * Checks status AND the agreement independently, because the punch list is explicit:
 * an expert whose status was flipped to 'active' by hand must still be blocked if
 * they have not signed. One condition guarding two facts would let that through.
 */
export function canBeAssigned(expert: Pick<Expert, "status"> & {
  agreementSignedAt?: string | undefined;
}): AssignmentEligibility {
  if (expert.status === "suspended") return { eligible: false, reason: "expert is suspended" };
  if (expert.status === "pending") return { eligible: false, reason: "application not yet approved" };
  if (!expert.agreementSignedAt) {
    return { eligible: false, reason: "service agreement not signed" };
  }
  return { eligible: true };
}

/** Reads the two fields the gate needs straight from the database. */
export function assignmentEligibility(db: Db, expertId: Id): AssignmentEligibility {
  const row = db
    .prepare(`SELECT status, agreement_signed_at FROM experts WHERE id = ?`)
    .get(expertId) as { status: Expert["status"]; agreement_signed_at: string | null } | undefined;
  if (!row) return { eligible: false, reason: "expert not found" };
  return canBeAssigned({
    status: row.status,
    agreementSignedAt: orUndefined(row.agreement_signed_at),
  });
}

/* --- Wallet ------------------------------------------------------------- */

export interface WalletBalance {
  expertId: Id;
  balanceCents: number;
  totalEarnedCents: number;
  pendingPayoutCents: number;
  totalWithdrawnCents: number;
}

export function ensureWallet(db: Db, expertId: Id): WalletBalance {
  const existing = readWallet(db, expertId);
  if (existing) return existing;
  db.prepare(`INSERT INTO wallets (id, expert_id, created_at) VALUES (?, ?, ?)`)
    .run(newId("wallet"), expertId, nowIso());
  return readWallet(db, expertId)!;
}

export function readWallet(db: Db, expertId: Id): WalletBalance | undefined {
  const r = db.prepare(`SELECT * FROM wallets WHERE expert_id = ?`).get(expertId) as
    | Record<string, unknown>
    | undefined;
  if (!r) return undefined;
  return {
    expertId,
    balanceCents: Number(r["balance_cents"]),
    totalEarnedCents: Number(r["total_earned_cents"]),
    pendingPayoutCents: Number(r["pending_payout_cents"]),
    totalWithdrawnCents: Number(r["total_withdrawn_cents"]),
  };
}

/** Credits a completed, rated review. Balance and lifetime earnings both move. */
export function creditReview(db: Db, expertId: Id, payoutCents: number): WalletBalance {
  if (payoutCents <= 0) throw new Error("payout must be positive");
  ensureWallet(db, expertId);
  db.prepare(
    `UPDATE wallets SET balance_cents = balance_cents + ?, total_earned_cents = total_earned_cents + ?
     WHERE expert_id = ?`,
  ).run(payoutCents, payoutCents, expertId);
  return readWallet(db, expertId)!;
}

export interface PayoutRequest {
  id: Id;
  expertId: Id;
  amountCents: number;
  status: "pending" | "completed" | "rejected";
  requestedAt: string;
}

/**
 * Moves funds from balance into pending in one guarded statement, so two concurrent
 * requests cannot both pass an "is there enough?" check and overdraw the wallet.
 */
export function requestPayout(db: Db, expertId: Id, amountCents: number): PayoutRequest {
  if (amountCents <= 0) throw new Error("payout amount must be positive");
  if (!readPayoutDetails(db, expertId)) {
    throw new Error("payout details must be on file before requesting a payout");
  }

  db.exec("BEGIN");
  try {
    const moved = db
      .prepare(
        `UPDATE wallets
         SET balance_cents = balance_cents - ?, pending_payout_cents = pending_payout_cents + ?
         WHERE expert_id = ? AND balance_cents >= ?`,
      )
      .run(amountCents, amountCents, expertId, amountCents);

    if (Number(moved.changes) === 0) {
      db.exec("ROLLBACK");
      throw new Error("insufficient balance");
    }

    const id = newId("payment");
    const requestedAt = nowIso();
    db.prepare(
      `INSERT INTO payouts (id, expert_id, amount_cents, status, requested_at)
       VALUES (?, ?, ?, 'pending', ?)`,
    ).run(id, expertId, amountCents, requestedAt);

    db.exec("COMMIT");
    return { id, expertId, amountCents, status: "pending", requestedAt };
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
    throw err;
  }
}

export function approvePayout(db: Db, payoutId: Id): WalletBalance {
  const p = db.prepare(`SELECT * FROM payouts WHERE id = ? AND status = 'pending'`).get(payoutId) as
    | Record<string, unknown>
    | undefined;
  if (!p) throw new Error("no pending payout with that id");

  const expertId = p["expert_id"] as string;
  const amount = Number(p["amount_cents"]);

  db.exec("BEGIN");
  try {
    db.prepare(
      `UPDATE wallets SET pending_payout_cents = pending_payout_cents - ?,
        total_withdrawn_cents = total_withdrawn_cents + ? WHERE expert_id = ?`,
    ).run(amount, amount, expertId);
    db.prepare(`UPDATE payouts SET status = 'completed', resolved_at = ? WHERE id = ?`)
      .run(nowIso(), payoutId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return readWallet(db, expertId)!;
}

/** Rejection returns the money to the spendable balance. */
export function rejectPayout(db: Db, payoutId: Id, note?: string): WalletBalance {
  const p = db.prepare(`SELECT * FROM payouts WHERE id = ? AND status = 'pending'`).get(payoutId) as
    | Record<string, unknown>
    | undefined;
  if (!p) throw new Error("no pending payout with that id");

  const expertId = p["expert_id"] as string;
  const amount = Number(p["amount_cents"]);

  db.exec("BEGIN");
  try {
    db.prepare(
      `UPDATE wallets SET pending_payout_cents = pending_payout_cents - ?,
        balance_cents = balance_cents + ? WHERE expert_id = ?`,
    ).run(amount, amount, expertId);
    db.prepare(`UPDATE payouts SET status = 'rejected', resolved_at = ?, note = ? WHERE id = ?`)
      .run(nowIso(), note ?? null, payoutId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return readWallet(db, expertId)!;
}

/* --- Payout details (encrypted) ----------------------------------------- */

export type PayoutMethod = "bank-transfer" | "mobile-money" | "paystack";

export interface PayoutDetailsInput {
  expertId: Id;
  accountHolderName: string;
  bankName: string;
  accountNumber: string;
  swiftBic?: string;
  payoutMethod: PayoutMethod;
  paystackRecipient?: string;
}

export interface PayoutDetailsView {
  expertId: Id;
  accountHolderName: string;
  bankName: string;
  /** Only ever the last four digits — the full number never leaves the database. */
  accountLast4: string;
  swiftBic?: string;
  payoutMethod: PayoutMethod;
  updatedAt: string;
}

const ALGO = "aes-256-gcm";

function key(secret: string): Buffer {
  // Deterministic salt: the secret is the rotation boundary, not the salt.
  return scryptSync(secret, "harmony-payout-details", 32);
}

export function encryptAccountNumber(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function decryptAccountNumber(stored: string, secret: string): string {
  const [ivB64, tagB64, dataB64] = stored.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("malformed encrypted account number");
  const decipher = createDecipheriv(ALGO, key(secret), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Stored only from inside the authenticated portal, after approval and signature —
 * never from the public application form, so bank details never sit in an
 * unauthenticated intake flow.
 */
export function savePayoutDetails(db: Db, input: PayoutDetailsInput, secret: string): PayoutDetailsView {
  const digits = input.accountNumber.replace(/\s+/g, "");
  if (digits.length < 4) throw new Error("account number is too short");

  const enc = encryptAccountNumber(digits, secret);
  const last4 = digits.slice(-4);
  const updatedAt = nowIso();

  db.prepare(
    `INSERT INTO payout_details (expert_id, account_holder_name, bank_name, account_number_enc,
       account_last4, swift_bic, payout_method, paystack_recipient, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (expert_id) DO UPDATE SET
       account_holder_name = excluded.account_holder_name,
       bank_name = excluded.bank_name,
       account_number_enc = excluded.account_number_enc,
       account_last4 = excluded.account_last4,
       swift_bic = excluded.swift_bic,
       payout_method = excluded.payout_method,
       paystack_recipient = excluded.paystack_recipient,
       updated_at = excluded.updated_at`,
  ).run(
    input.expertId, input.accountHolderName, input.bankName, enc, last4,
    input.swiftBic ?? null, input.payoutMethod, input.paystackRecipient ?? null, updatedAt,
  );

  return readPayoutDetails(db, input.expertId)!;
}

/** The UI-safe view. There is deliberately no function that returns the full number. */
export function readPayoutDetails(db: Db, expertId: Id): PayoutDetailsView | undefined {
  const r = db.prepare(`SELECT * FROM payout_details WHERE expert_id = ?`).get(expertId) as
    | Record<string, unknown>
    | undefined;
  if (!r) return undefined;
  return {
    expertId,
    accountHolderName: r["account_holder_name"] as string,
    bankName: r["bank_name"] as string,
    accountLast4: r["account_last4"] as string,
    swiftBic: orUndefined(r["swift_bic"] as string | null),
    payoutMethod: r["payout_method"] as PayoutMethod,
    updatedAt: r["updated_at"] as string,
  };
}

/** Decrypts for a transfer only. Callers must be the payout worker, never a route. */
export function revealAccountNumberForTransfer(db: Db, expertId: Id, secret: string): string {
  const r = db.prepare(`SELECT account_number_enc FROM payout_details WHERE expert_id = ?`)
    .get(expertId) as { account_number_enc: string } | undefined;
  if (!r) throw new Error("no payout details on file");
  return decryptAccountNumber(r.account_number_enc, secret);
}
