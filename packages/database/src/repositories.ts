import { newId } from "@harmony/shared";
import type {
  AuditEntry,
  Expert,
  Id,
  Payment,
  Report,
  Review,
  Session,
  Submission,
  SubmissionStatus,
  User,
  UserRole,
} from "@harmony/shared";
import {
  fromDbBool,
  fromJson,
  nowIso,
  orUndefined,
  toDbBool,
  toJson,
  type Db,
} from "./db.js";

/* --- Row mappers -------------------------------------------------------- */

type Row = Record<string, unknown>;

const toUser = (r: Row): User => ({
  id: r["id"] as string,
  name: r["name"] as string,
  email: r["email"] as string,
  role: r["role"] as UserRole,
  organisation: orUndefined(r["organisation"] as string | null),
  createdAt: r["created_at"] as string,
});

const toExpert = (r: Row): Expert => ({
  id: r["id"] as string,
  userId: r["user_id"] as string,
  name: r["name"] as string,
  specialty: r["specialty"] as Expert["specialty"],
  subSpecialty: orUndefined(r["sub_specialty"] as string | null),
  credentials: r["credentials"] as string,
  yearsExperience: Number(r["years_experience"]),
  availability: r["availability"] as Expert["availability"],
  rating: Number(r["rating"]),
  ratingCount: Number(r["rating_count"]),
  status: r["status"] as Expert["status"],
  conflictsOfInterest: fromJson<string[]>(r["conflicts_of_interest"], []),
  activeCaseCount: Number(r["active_case_count"]),
  maxConcurrentCases: Number(r["max_concurrent_cases"]),
  createdAt: r["created_at"] as string,
});

const toSubmission = (r: Row): Submission => ({
  id: r["id"] as string,
  customerId: r["customer_id"] as string,
  title: r["title"] as string,
  aiSystem: r["ai_system"] as string,
  content: r["content"] as string,
  fileUrl: orUndefined(r["file_url"] as string | null),
  specialty: r["specialty"] as Submission["specialty"],
  reviewType: r["review_type"] as Submission["reviewType"],
  priority: r["priority"] as Submission["priority"],
  complexity: orUndefined(r["complexity"] as Submission["complexity"] | null),
  riskLevel: orUndefined(r["risk_level"] as Submission["riskLevel"] | null),
  status: r["status"] as SubmissionStatus,
  assignedExpertId: orUndefined(r["assigned_expert_id"] as string | null),
  priceCents: orUndefined(r["price_cents"] as number | null),
  eta: orUndefined(r["eta"] as string | null),
  reportUrl: orUndefined(r["report_url"] as string | null),
  createdAt: r["created_at"] as string,
  updatedAt: r["updated_at"] as string,
});

const toReview = (r: Row): Review => ({
  id: r["id"] as string,
  submissionId: r["submission_id"] as string,
  expertId: r["expert_id"] as string,
  status: r["status"] as Review["status"],
  accuracy: orUndefined(r["accuracy"] as Review["accuracy"] | null),
  hallucinationDetected: fromDbBool(r["hallucination_detected"]),
  hallucinationDetails: orUndefined(r["hallucination_details"] as string | null),
  missingInformation: fromDbBool(r["missing_information"]),
  missingInformationDetails: orUndefined(r["missing_information_details"] as string | null),
  safetyLevel: orUndefined(r["safety_level"] as Review["safetyLevel"] | null),
  clinicalReasoning: orUndefined(r["clinical_reasoning"] as Review["clinicalReasoning"] | null),
  verdict: orUndefined(r["verdict"] as Review["verdict"] | null),
  comments: orUndefined(r["comments"] as string | null),
  assignedAt: r["assigned_at"] as string,
  acceptedAt: orUndefined(r["accepted_at"] as string | null),
  submittedAt: orUndefined(r["submitted_at"] as string | null),
});

const toReport = (r: Row): Report => ({
  id: r["id"] as string,
  submissionId: r["submission_id"] as string,
  verificationScore: Number(r["verification_score"]),
  summary: r["summary"] as string,
  pdfUrl: orUndefined(r["pdf_url"] as string | null),
  createdAt: r["created_at"] as string,
});

/* --- Users -------------------------------------------------------------- */

export const users = (db: Db) => ({
  create(input: {
    name: string;
    email: string;
    role: UserRole;
    organisation?: string;
    passwordHash: string;
    passwordSalt: string;
  }): User {
    const id = newId("user");
    const createdAt = nowIso();
    db.prepare(
      `INSERT INTO users (id, name, email, role, organisation, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, input.name, input.email, input.role, input.organisation ?? null, createdAt);
    db.prepare(
      `INSERT INTO user_credentials (user_id, password_hash, password_salt) VALUES (?, ?, ?)`,
    ).run(id, input.passwordHash, input.passwordSalt);
    return {
      id,
      name: input.name,
      email: input.email,
      role: input.role,
      organisation: input.organisation,
      createdAt,
    };
  },

  byId(id: Id): User | undefined {
    const r = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as Row | undefined;
    return r ? toUser(r) : undefined;
  },

  byEmail(email: string): User | undefined {
    const r = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as Row | undefined;
    return r ? toUser(r) : undefined;
  },

  credentials(userId: Id): { passwordHash: string; passwordSalt: string } | undefined {
    const r = db.prepare(`SELECT * FROM user_credentials WHERE user_id = ?`).get(userId) as
      | Row
      | undefined;
    return r
      ? { passwordHash: r["password_hash"] as string, passwordSalt: r["password_salt"] as string }
      : undefined;
  },

  list(role?: UserRole): User[] {
    const rows = role
      ? (db.prepare(`SELECT * FROM users WHERE role = ? ORDER BY created_at DESC`).all(role) as Row[])
      : (db.prepare(`SELECT * FROM users ORDER BY created_at DESC`).all() as Row[]);
    return rows.map(toUser);
  },
});

/* --- Sessions ----------------------------------------------------------- */

export const sessions = (db: Db) => ({
  create(token: string, userId: Id, role: UserRole, expiresAt: string): Session {
    db.prepare(
      `INSERT INTO sessions (token, user_id, role, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(token, userId, role, expiresAt, nowIso());
    return { token, userId, role, expiresAt };
  },

  byToken(token: string): Session | undefined {
    const r = db.prepare(`SELECT * FROM sessions WHERE token = ?`).get(token) as Row | undefined;
    if (!r) return undefined;
    return {
      token: r["token"] as string,
      userId: r["user_id"] as string,
      role: r["role"] as UserRole,
      expiresAt: r["expires_at"] as string,
    };
  },

  destroy(token: string): void {
    db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
  },

  purgeExpired(): number {
    const r = db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(nowIso());
    return Number(r.changes);
  },
});

/* --- Experts ------------------------------------------------------------ */

export const experts = (db: Db) => ({
  create(input: Omit<Expert, "id" | "createdAt" | "rating" | "ratingCount" | "activeCaseCount">
    & Partial<Pick<Expert, "rating" | "ratingCount" | "activeCaseCount">>): Expert {
    const id = newId("expert");
    const createdAt = nowIso();
    const record: Expert = {
      ...input,
      id,
      createdAt,
      rating: input.rating ?? 0,
      ratingCount: input.ratingCount ?? 0,
      activeCaseCount: input.activeCaseCount ?? 0,
    };
    db.prepare(
      `INSERT INTO experts (id, user_id, name, specialty, sub_specialty, credentials,
        years_experience, availability, rating, rating_count, status, conflicts_of_interest,
        active_case_count, max_concurrent_cases, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, record.userId, record.name, record.specialty, record.subSpecialty ?? null,
      record.credentials, record.yearsExperience, record.availability, record.rating,
      record.ratingCount, record.status, toJson(record.conflictsOfInterest),
      record.activeCaseCount, record.maxConcurrentCases, createdAt,
    );
    return record;
  },

  byId(id: Id): Expert | undefined {
    const r = db.prepare(`SELECT * FROM experts WHERE id = ?`).get(id) as Row | undefined;
    return r ? toExpert(r) : undefined;
  },

  byUserId(userId: Id): Expert | undefined {
    const r = db.prepare(`SELECT * FROM experts WHERE user_id = ?`).get(userId) as Row | undefined;
    return r ? toExpert(r) : undefined;
  },

  list(filter: { status?: Expert["status"]; specialty?: Expert["specialty"] } = {}): Expert[] {
    const clauses: string[] = [];
    const args: unknown[] = [];
    if (filter.status) { clauses.push("status = ?"); args.push(filter.status); }
    if (filter.specialty) { clauses.push("specialty = ?"); args.push(filter.specialty); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db
      .prepare(`SELECT * FROM experts ${where} ORDER BY rating DESC, years_experience DESC`)
      .all(...(args as never[])) as Row[];
    return rows.map(toExpert);
  },

  setStatus(id: Id, status: Expert["status"]): void {
    db.prepare(`UPDATE experts SET status = ? WHERE id = ?`).run(status, id);
  },

  setAvailability(id: Id, availability: Expert["availability"]): void {
    db.prepare(`UPDATE experts SET availability = ? WHERE id = ?`).run(availability, id);
  },

  /** Guarded so concurrent assignment can never push an expert past their cap. */
  incrementCaseCount(id: Id, delta: number): boolean {
    const r = db
      .prepare(
        `UPDATE experts SET active_case_count = active_case_count + ?
         WHERE id = ?
           AND active_case_count + ? >= 0
           AND active_case_count + ? <= max_concurrent_cases`,
      )
      .run(delta, id, delta, delta);
    return Number(r.changes) > 0;
  },

  recordRating(id: Id, stars: number): void {
    db.prepare(
      `UPDATE experts
       SET rating = ((rating * rating_count) + ?) / (rating_count + 1),
           rating_count = rating_count + 1
       WHERE id = ?`,
    ).run(stars, id);
  },
});

/* --- Submissions -------------------------------------------------------- */

export const submissions = (db: Db) => ({
  create(input: {
    customerId: Id;
    title: string;
    aiSystem: string;
    content: string;
    fileUrl?: string;
    specialty: Submission["specialty"];
    reviewType: Submission["reviewType"];
    priority: Submission["priority"];
  }): Submission {
    const id = newId("submission");
    const at = nowIso();
    db.prepare(
      `INSERT INTO submissions (id, customer_id, title, ai_system, content, file_url,
         specialty, review_type, priority, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?)`,
    ).run(
      id, input.customerId, input.title, input.aiSystem, input.content, input.fileUrl ?? null,
      input.specialty, input.reviewType, input.priority, at, at,
    );
    return { ...input, id, status: "submitted", createdAt: at, updatedAt: at };
  },

  byId(id: Id): Submission | undefined {
    const r = db.prepare(`SELECT * FROM submissions WHERE id = ?`).get(id) as Row | undefined;
    return r ? toSubmission(r) : undefined;
  },

  listForCustomer(customerId: Id): Submission[] {
    const rows = db
      .prepare(`SELECT * FROM submissions WHERE customer_id = ? ORDER BY created_at DESC`)
      .all(customerId) as Row[];
    return rows.map(toSubmission);
  },

  listForExpert(expertId: Id): Submission[] {
    const rows = db
      .prepare(`SELECT * FROM submissions WHERE assigned_expert_id = ? ORDER BY created_at DESC`)
      .all(expertId) as Row[];
    return rows.map(toSubmission);
  },

  list(filter: { status?: SubmissionStatus } = {}): Submission[] {
    const rows = filter.status
      ? (db.prepare(`SELECT * FROM submissions WHERE status = ? ORDER BY created_at DESC`)
          .all(filter.status) as Row[])
      : (db.prepare(`SELECT * FROM submissions ORDER BY created_at DESC`).all() as Row[]);
    return rows.map(toSubmission);
  },

  applyAnalysis(id: Id, a: {
    specialty: Submission["specialty"];
    complexity: Submission["complexity"];
    riskLevel: Submission["riskLevel"];
    priceCents: number;
    eta: string;
  }): void {
    db.prepare(
      `UPDATE submissions
       SET specialty = ?, complexity = ?, risk_level = ?, price_cents = ?, eta = ?,
           status = 'analyzing', updated_at = ?
       WHERE id = ?`,
    ).run(a.specialty, a.complexity ?? null, a.riskLevel ?? null, a.priceCents, a.eta, nowIso(), id);
  },

  assignExpert(id: Id, expertId: Id): void {
    db.prepare(
      `UPDATE submissions SET assigned_expert_id = ?, status = 'expert-assigned', updated_at = ?
       WHERE id = ?`,
    ).run(expertId, nowIso(), id);
  },

  setStatus(id: Id, status: SubmissionStatus): void {
    db.prepare(`UPDATE submissions SET status = ?, updated_at = ? WHERE id = ?`)
      .run(status, nowIso(), id);
  },

  setReportUrl(id: Id, url: string): void {
    db.prepare(`UPDATE submissions SET report_url = ?, updated_at = ? WHERE id = ?`)
      .run(url, nowIso(), id);
  },

  countByStatus(): Record<string, number> {
    const rows = db
      .prepare(`SELECT status, COUNT(*) AS n FROM submissions GROUP BY status`)
      .all() as Row[];
    return Object.fromEntries(rows.map((r) => [r["status"] as string, Number(r["n"])]));
  },
});

/* --- Reviews ------------------------------------------------------------ */

export const reviews = (db: Db) => ({
  create(submissionId: Id, expertId: Id): Review {
    const id = newId("review");
    const assignedAt = nowIso();
    db.prepare(
      `INSERT INTO reviews (id, submission_id, expert_id, status, assigned_at)
       VALUES (?, ?, ?, 'assigned', ?)`,
    ).run(id, submissionId, expertId, assignedAt);
    return { id, submissionId, expertId, status: "assigned", assignedAt };
  },

  byId(id: Id): Review | undefined {
    const r = db.prepare(`SELECT * FROM reviews WHERE id = ?`).get(id) as Row | undefined;
    return r ? toReview(r) : undefined;
  },

  bySubmission(submissionId: Id): Review | undefined {
    const r = db.prepare(`SELECT * FROM reviews WHERE submission_id = ?`).get(submissionId) as
      | Row
      | undefined;
    return r ? toReview(r) : undefined;
  },

  queueForExpert(expertId: Id): Review[] {
    const rows = db
      .prepare(
        `SELECT * FROM reviews WHERE expert_id = ? AND status IN ('assigned','accepted')
         ORDER BY assigned_at ASC`,
      )
      .all(expertId) as Row[];
    return rows.map(toReview);
  },

  completedForExpert(expertId: Id): Review[] {
    const rows = db
      .prepare(
        `SELECT * FROM reviews WHERE expert_id = ? AND status = 'submitted'
         ORDER BY submitted_at DESC`,
      )
      .all(expertId) as Row[];
    return rows.map(toReview);
  },

  accept(id: Id): void {
    db.prepare(`UPDATE reviews SET status = 'accepted', accepted_at = ? WHERE id = ?`)
      .run(nowIso(), id);
  },

  reject(id: Id): void {
    db.prepare(`UPDATE reviews SET status = 'rejected' WHERE id = ?`).run(id);
  },

  submit(id: Id, findings: {
    accuracy: Review["accuracy"];
    hallucinationDetected: boolean;
    hallucinationDetails?: string;
    missingInformation: boolean;
    missingInformationDetails?: string;
    safetyLevel: Review["safetyLevel"];
    clinicalReasoning: Review["clinicalReasoning"];
    verdict: Review["verdict"];
    comments?: string;
  }): void {
    db.prepare(
      `UPDATE reviews SET status = 'submitted', accuracy = ?, hallucination_detected = ?,
         hallucination_details = ?, missing_information = ?, missing_information_details = ?,
         safety_level = ?, clinical_reasoning = ?, verdict = ?, comments = ?, submitted_at = ?
       WHERE id = ?`,
    ).run(
      findings.accuracy ?? null,
      toDbBool(findings.hallucinationDetected),
      findings.hallucinationDetails ?? null,
      toDbBool(findings.missingInformation),
      findings.missingInformationDetails ?? null,
      findings.safetyLevel ?? null,
      findings.clinicalReasoning ?? null,
      findings.verdict ?? null,
      findings.comments ?? null,
      nowIso(),
      id,
    );
  },
});

/* --- Reports ------------------------------------------------------------ */

export const reports = (db: Db) => ({
  create(input: { submissionId: Id; verificationScore: number; summary: string; pdfUrl?: string }): Report {
    const id = newId("record");
    const createdAt = nowIso();
    db.prepare(
      `INSERT INTO reports (id, submission_id, verification_score, summary, pdf_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, input.submissionId, input.verificationScore, input.summary, input.pdfUrl ?? null, createdAt);
    return { ...input, id, createdAt };
  },

  bySubmission(submissionId: Id): Report | undefined {
    const r = db.prepare(`SELECT * FROM reports WHERE submission_id = ?`).get(submissionId) as
      | Row
      | undefined;
    return r ? toReport(r) : undefined;
  },

  listForCustomer(customerId: Id): Array<Report & { title: string; specialty: string }> {
    const rows = db
      .prepare(
        `SELECT r.*, s.title, s.specialty FROM reports r
         JOIN submissions s ON s.id = r.submission_id
         WHERE s.customer_id = ? ORDER BY r.created_at DESC`,
      )
      .all(customerId) as Row[];
    return rows.map((r) => ({
      ...toReport(r),
      title: r["title"] as string,
      specialty: r["specialty"] as string,
    }));
  },
});

/* --- Payments ----------------------------------------------------------- */

export const payments = (db: Db) => ({
  create(input: { submissionId: Id; amountCents: number; provider: string; reference?: string }): Payment {
    const id = newId("payment");
    const createdAt = nowIso();
    db.prepare(
      `INSERT INTO payments (id, submission_id, amount_cents, currency, status, provider, reference, created_at)
       VALUES (?, ?, ?, 'USD', 'pending', ?, ?, ?)`,
    ).run(id, input.submissionId, input.amountCents, input.provider, input.reference ?? null, createdAt);
    return { ...input, id, currency: "USD", status: "pending", createdAt };
  },

  markPaid(id: Id, reference?: string): void {
    db.prepare(`UPDATE payments SET status = 'paid', reference = COALESCE(?, reference) WHERE id = ?`)
      .run(reference ?? null, id);
  },

  totalRevenueCents(): number {
    const r = db
      .prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS total FROM payments WHERE status = 'paid'`)
      .get() as Row;
    return Number(r["total"]);
  },
});

/* --- Audit -------------------------------------------------------------- */

export const audit = (db: Db) => ({
  record(entry: Omit<AuditEntry, "id" | "at">): AuditEntry {
    const id = newId("audit");
    const at = nowIso();
    db.prepare(
      `INSERT INTO audit_log (id, actor_id, actor_role, action, target_type, target_id, metadata, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, entry.actorId, entry.actorRole, entry.action, entry.targetType, entry.targetId,
      entry.metadata ? toJson(entry.metadata) : null, at,
    );
    return { ...entry, id, at };
  },

  forTarget(targetType: string, targetId: Id): AuditEntry[] {
    const rows = db
      .prepare(`SELECT * FROM audit_log WHERE target_type = ? AND target_id = ? ORDER BY at ASC`)
      .all(targetType, targetId) as Row[];
    return rows.map((r) => ({
      id: r["id"] as string,
      actorId: r["actor_id"] as string,
      actorRole: r["actor_role"] as UserRole,
      action: r["action"] as string,
      targetType: r["target_type"] as string,
      targetId: r["target_id"] as string,
      metadata: fromJson<Record<string, unknown> | undefined>(r["metadata"], undefined),
      at: r["at"] as string,
    }));
  },
});

/* --- Facade ------------------------------------------------------------- */

export function createRepositories(db: Db) {
  return {
    db,
    users: users(db),
    sessions: sessions(db),
    experts: experts(db),
    submissions: submissions(db),
    reviews: reviews(db),
    reports: reports(db),
    payments: payments(db),
    audit: audit(db),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
