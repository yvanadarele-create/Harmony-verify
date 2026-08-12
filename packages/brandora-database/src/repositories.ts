/**
 * Repositories.
 *
 * One rule shapes every read in this file: **ownership is part of the query, not
 * a check after it.**
 *
 * `findProject(projectId)` followed by `if (project.userId !== me) throw` is the
 * shape that produces IDOR vulnerabilities, because the day someone adds a new
 * route they will remember the first line and forget the second. So the customer
 * methods take an owner and put it in the `WHERE` clause: a project belonging to
 * someone else is not "found and rejected", it is simply not found.
 *
 * Admin methods are named `…AsAdmin` so that an unscoped read is impossible to
 * write by accident and obvious to spot in review.
 */

import {
  type BrandProfile,
  type ColorSwatch,
  type CurrencyCode,
  type Locale,
  type Money,
  type Positioning,
  type Typography,
  type UserRole,
  newId,
} from "@brandora/shared";
import {
  type Db,
  fromJson,
  int,
  nowIso,
  optionalText,
  readMoney,
  text,
  toJson,
} from "./db.js";

/* --- Users ---------------------------------------------------------------- */

export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  locale: Locale;
  currency: CurrencyCode;
  country?: string;
  phone?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialRow {
  userId: string;
  passwordHash: string;
  passwordSalt: string;
}

function toUser(row: Record<string, unknown>): UserRow {
  return {
    id: text(row["id"]),
    email: text(row["email"]),
    name: text(row["name"]),
    role: text(row["role"]) as UserRole,
    locale: text(row["locale"]) as Locale,
    currency: text(row["currency"]) as CurrencyCode,
    country: optionalText(row["country"]),
    phone: optionalText(row["phone"]),
    createdAt: text(row["created_at"]),
    updatedAt: text(row["updated_at"]),
  };
}

/* --- Projects ------------------------------------------------------------- */

export type ProjectStatus = "draft" | "interviewing" | "generated" | "active" | "archived";

export interface ProjectRow {
  id: string;
  userId: string;
  name: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

const toProject = (row: Record<string, unknown>): ProjectRow => ({
  id: text(row["id"]),
  userId: text(row["user_id"]),
  name: text(row["name"]),
  status: text(row["status"]) as ProjectStatus,
  createdAt: text(row["created_at"]),
  updatedAt: text(row["updated_at"]),
});

export interface InterviewRow {
  id: string;
  projectId: string;
  responses: Record<string, unknown>;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StrategyRow {
  id: string;
  projectId: string;
  name: string;
  description: string;
  industry: string;
  positioning: Positioning;
  targetCustomer: string;
  personality: string[];
  promise: string;
  mission: string;
  vision: string;
  slogan: string;
  toneOfVoice: string;
  brandStory: string;
  nameAlternatives: string[];
  createdAt: string;
}

export interface IdentityRow {
  id: string;
  projectId: string;
  palette: ColorSwatch[];
  typography: Typography;
  logoBrief: string;
  logoUrl?: string;
  createdAt: string;
  updatedAt: string;
}

/* --- Quotes and orders ---------------------------------------------------- */

export type QuoteStatusRow = "draft" | "sent" | "approved" | "rejected" | "expired";

export interface QuoteLineRow {
  productId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface QuoteRow {
  id: string;
  projectId: string;
  userId: string;
  reference: string;
  currency: CurrencyCode;
  lineItems: QuoteLineRow[];
  subtotal: Money;
  shipping: Money;
  fees: Money;
  total: Money;
  status: QuoteStatusRow;
  validUntil: string;
  createdAt: string;
}

/** Includes margin. Only ever returned by an admin method. */
export interface QuoteRowInternal extends QuoteRow {
  margin: Money;
}

export type PaymentStatus = "unpaid" | "pending" | "paid" | "failed" | "refunded";
export type FulfillmentStatus =
  | "pending"
  | "confirmed"
  | "sourcing"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled";

export interface OrderRow {
  id: string;
  userId: string;
  projectId: string;
  quoteId: string;
  reference: string;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  total: Money;
  currency: CurrencyCode;
  supplierOrderId?: string;
  trackingNumber?: string;
  carrier?: string;
  createdAt: string;
  updatedAt: string;
}

function toQuote(row: Record<string, unknown>): QuoteRow {
  const currency = text(row["currency"]) as CurrencyCode;
  return {
    id: text(row["id"]),
    projectId: text(row["project_id"]),
    userId: text(row["user_id"]),
    reference: text(row["reference"]),
    currency,
    lineItems: fromJson<QuoteLineRow[]>(row["line_items"], []),
    subtotal: readMoney(row["subtotal"], currency),
    shipping: readMoney(row["shipping"], currency),
    fees: readMoney(row["fees"], currency),
    total: readMoney(row["total"], currency),
    status: text(row["status"]) as QuoteStatusRow,
    validUntil: text(row["valid_until"]),
    createdAt: text(row["created_at"]),
  };
}

const toOrder = (row: Record<string, unknown>): OrderRow => {
  const currency = text(row["currency"]) as CurrencyCode;
  return {
    id: text(row["id"]),
    userId: text(row["user_id"]),
    projectId: text(row["project_id"]),
    quoteId: text(row["quote_id"]),
    reference: text(row["reference"]),
    paymentStatus: text(row["payment_status"]) as PaymentStatus,
    fulfillmentStatus: text(row["fulfillment_status"]) as FulfillmentStatus,
    total: readMoney(row["total"], currency),
    currency,
    supplierOrderId: optionalText(row["supplier_order_id"]),
    trackingNumber: optionalText(row["tracking_number"]),
    carrier: optionalText(row["carrier"]),
    createdAt: text(row["created_at"]),
    updatedAt: text(row["updated_at"]),
  };
};

/* --- The repositories ----------------------------------------------------- */

export interface Repositories {
  users: {
    create(input: {
      email: string;
      name: string;
      role?: UserRole;
      locale?: Locale;
      currency?: CurrencyCode;
      country?: string;
      phone?: string;
    }): UserRow;
    findById(id: string): UserRow | null;
    findByEmail(email: string): UserRow | null;
    setCredentials(userId: string, passwordHash: string, passwordSalt: string): void;
    credentialsFor(userId: string): CredentialRow | null;
    setRole(userId: string, role: UserRole): void;
    listAsAdmin(limit?: number): UserRow[];
  };

  sessions: {
    create(userId: string, token: string, expiresAt: string): void;
    find(token: string): { token: string; userId: string; expiresAt: string } | null;
    destroy(token: string): void;
    destroyAllFor(userId: string): void;
    purgeExpired(now?: string): number;
  };

  projects: {
    create(userId: string, name: string): ProjectRow;
    /** Scoped to the owner. Another user's project is not found, not refused. */
    findForOwner(id: string, userId: string): ProjectRow | null;
    listForOwner(userId: string): ProjectRow[];
    setStatus(id: string, userId: string, status: ProjectStatus): void;
    rename(id: string, userId: string, name: string): void;
    findAsAdmin(id: string): ProjectRow | null;
    listAsAdmin(limit?: number): ProjectRow[];
  };

  interviews: {
    save(projectId: string, responses: Record<string, unknown>, completed: boolean): InterviewRow;
    findForProject(projectId: string): InterviewRow | null;
  };

  strategies: {
    save(projectId: string, strategy: Omit<StrategyRow, "id" | "projectId" | "createdAt">, raw: unknown): StrategyRow;
    findForProject(projectId: string): StrategyRow | null;
  };

  identities: {
    save(projectId: string, identity: Omit<IdentityRow, "id" | "projectId" | "createdAt" | "updatedAt">): IdentityRow;
    findForProject(projectId: string): IdentityRow | null;
  };

  quotes: {
    create(input: {
      projectId: string;
      userId: string;
      reference: string;
      currency: CurrencyCode;
      lineItems: QuoteLineRow[];
      subtotal: number;
      shipping: number;
      fees: number;
      total: number;
      margin: number;
      validUntil: string;
    }): QuoteRow;
    findForOwner(id: string, userId: string): QuoteRow | null;
    listForOwner(userId: string): QuoteRow[];
    setStatus(id: string, status: QuoteStatusRow): void;
    /** Returns margin. Admin surfaces only. */
    findAsAdmin(id: string): QuoteRowInternal | null;
    listAsAdmin(limit?: number): QuoteRowInternal[];
  };

  orders: {
    create(input: {
      userId: string;
      projectId: string;
      quoteId: string;
      reference: string;
      total: number;
      currency: CurrencyCode;
    }): OrderRow;
    findForOwner(id: string, userId: string): OrderRow | null;
    listForOwner(userId: string): OrderRow[];
    setPaymentStatus(id: string, status: PaymentStatus): void;
    setFulfillmentStatus(id: string, status: FulfillmentStatus): void;
    addEvent(orderId: string, kind: string, actor: string, detail?: string): void;
    events(orderId: string): { at: string; kind: string; actor: string; detail?: string }[];
    findAsAdmin(id: string): OrderRow | null;
    listAsAdmin(limit?: number): OrderRow[];
  };
}

export function createRepositories(db: Db): Repositories {
  const get = (sql: string, ...params: unknown[]): Record<string, unknown> | null =>
    (db.prepare(sql).get(...(params as never[])) as Record<string, unknown> | undefined) ?? null;

  const all = (sql: string, ...params: unknown[]): Record<string, unknown>[] =>
    db.prepare(sql).all(...(params as never[])) as Record<string, unknown>[];

  const run = (sql: string, ...params: unknown[]): void => {
    db.prepare(sql).run(...(params as never[]));
  };

  return {
    users: {
      create(input) {
        const now = nowIso();
        const user: UserRow = {
          id: newId("user"),
          email: input.email.trim().toLowerCase(),
          name: input.name.trim(),
          role: input.role ?? "customer",
          locale: input.locale ?? "en",
          currency: input.currency ?? "XOF",
          country: input.country,
          phone: input.phone,
          createdAt: now,
          updatedAt: now,
        };
        run(
          `INSERT INTO users (id,email,name,role,locale,currency,country,phone,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          user.id, user.email, user.name, user.role, user.locale, user.currency,
          user.country ?? null, user.phone ?? null, now, now,
        );
        return user;
      },

      findById(id) {
        const row = get(`SELECT * FROM users WHERE id = ?`, id);
        return row ? toUser(row) : null;
      },

      findByEmail(email) {
        const row = get(`SELECT * FROM users WHERE email = ? COLLATE NOCASE`, email.trim().toLowerCase());
        return row ? toUser(row) : null;
      },

      setCredentials(userId, passwordHash, passwordSalt) {
        run(
          `INSERT INTO user_credentials (user_id,password_hash,password_salt,updated_at)
           VALUES (?,?,?,?)
           ON CONFLICT(user_id) DO UPDATE SET
             password_hash = excluded.password_hash,
             password_salt = excluded.password_salt,
             updated_at    = excluded.updated_at`,
          userId, passwordHash, passwordSalt, nowIso(),
        );
      },

      credentialsFor(userId) {
        const row = get(`SELECT * FROM user_credentials WHERE user_id = ?`, userId);
        return row
          ? {
              userId: text(row["user_id"]),
              passwordHash: text(row["password_hash"]),
              passwordSalt: text(row["password_salt"]),
            }
          : null;
      },

      setRole(userId, role) {
        run(`UPDATE users SET role = ?, updated_at = ? WHERE id = ?`, role, nowIso(), userId);
      },

      listAsAdmin(limit = 100) {
        return all(`SELECT * FROM users ORDER BY created_at DESC LIMIT ?`, limit).map(toUser);
      },
    },

    sessions: {
      create(userId, token, expiresAt) {
        run(
          `INSERT INTO sessions (token,user_id,expires_at,created_at) VALUES (?,?,?,?)`,
          token, userId, expiresAt, nowIso(),
        );
      },

      find(token) {
        const row = get(`SELECT * FROM sessions WHERE token = ?`, token);
        return row
          ? { token: text(row["token"]), userId: text(row["user_id"]), expiresAt: text(row["expires_at"]) }
          : null;
      },

      destroy(token) {
        run(`DELETE FROM sessions WHERE token = ?`, token);
      },

      destroyAllFor(userId) {
        run(`DELETE FROM sessions WHERE user_id = ?`, userId);
      },

      purgeExpired(now = nowIso()) {
        const before = int(get(`SELECT COUNT(*) AS n FROM sessions`)?.["n"]);
        run(`DELETE FROM sessions WHERE expires_at < ?`, now);
        const after = int(get(`SELECT COUNT(*) AS n FROM sessions`)?.["n"]);
        return before - after;
      },
    },

    projects: {
      create(userId, name) {
        const now = nowIso();
        const project: ProjectRow = {
          id: newId("brand"),
          userId,
          name: name.trim() || "Untitled brand",
          status: "draft",
          createdAt: now,
          updatedAt: now,
        };
        run(
          `INSERT INTO brand_projects (id,user_id,name,status,created_at,updated_at) VALUES (?,?,?,?,?,?)`,
          project.id, project.userId, project.name, project.status, now, now,
        );
        return project;
      },

      findForOwner(id, userId) {
        const row = get(`SELECT * FROM brand_projects WHERE id = ? AND user_id = ?`, id, userId);
        return row ? toProject(row) : null;
      },

      listForOwner(userId) {
        return all(
          `SELECT * FROM brand_projects WHERE user_id = ? ORDER BY updated_at DESC`,
          userId,
        ).map(toProject);
      },

      setStatus(id, userId, status) {
        run(
          `UPDATE brand_projects SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
          status, nowIso(), id, userId,
        );
      },

      rename(id, userId, name) {
        run(
          `UPDATE brand_projects SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
          name, nowIso(), id, userId,
        );
      },

      findAsAdmin(id) {
        const row = get(`SELECT * FROM brand_projects WHERE id = ?`, id);
        return row ? toProject(row) : null;
      },

      listAsAdmin(limit = 100) {
        return all(`SELECT * FROM brand_projects ORDER BY updated_at DESC LIMIT ?`, limit).map(toProject);
      },
    },

    interviews: {
      save(projectId, responses, completed) {
        const now = nowIso();
        const existing = get(`SELECT * FROM interviews WHERE project_id = ?`, projectId);
        const id = existing ? text(existing["id"]) : newId("conversation");
        const completedAt = completed ? now : null;

        run(
          `INSERT INTO interviews (id,project_id,responses,completed_at,created_at,updated_at)
           VALUES (?,?,?,?,?,?)
           ON CONFLICT(project_id) DO UPDATE SET
             responses    = excluded.responses,
             completed_at = excluded.completed_at,
             updated_at   = excluded.updated_at`,
          id, projectId, toJson(responses), completedAt, now, now,
        );

        return {
          id,
          projectId,
          responses,
          completedAt: completedAt ?? undefined,
          createdAt: existing ? text(existing["created_at"]) : now,
          updatedAt: now,
        };
      },

      findForProject(projectId) {
        const row = get(`SELECT * FROM interviews WHERE project_id = ?`, projectId);
        if (!row) return null;
        return {
          id: text(row["id"]),
          projectId: text(row["project_id"]),
          responses: fromJson<Record<string, unknown>>(row["responses"], {}),
          completedAt: optionalText(row["completed_at"]),
          createdAt: text(row["created_at"]),
          updatedAt: text(row["updated_at"]),
        };
      },
    },

    strategies: {
      save(projectId, strategy, raw) {
        const now = nowIso();
        const existing = get(`SELECT id FROM brand_strategies WHERE project_id = ?`, projectId);
        const id = existing ? text(existing["id"]) : newId("asset");

        run(
          `INSERT INTO brand_strategies
             (id,project_id,name,description,industry,positioning,target_customer,personality,
              promise,mission,vision,slogan,tone_of_voice,brand_story,name_alternatives,
              raw_validated_output,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(project_id) DO UPDATE SET
             name=excluded.name, description=excluded.description, industry=excluded.industry,
             positioning=excluded.positioning, target_customer=excluded.target_customer,
             personality=excluded.personality, promise=excluded.promise, mission=excluded.mission,
             vision=excluded.vision, slogan=excluded.slogan, tone_of_voice=excluded.tone_of_voice,
             brand_story=excluded.brand_story, name_alternatives=excluded.name_alternatives,
             raw_validated_output=excluded.raw_validated_output`,
          id, projectId, strategy.name, strategy.description, strategy.industry, strategy.positioning,
          strategy.targetCustomer, toJson(strategy.personality), strategy.promise, strategy.mission,
          strategy.vision, strategy.slogan, strategy.toneOfVoice, strategy.brandStory,
          toJson(strategy.nameAlternatives), toJson(raw), now,
        );

        return { ...strategy, id, projectId, createdAt: now };
      },

      findForProject(projectId) {
        const row = get(`SELECT * FROM brand_strategies WHERE project_id = ?`, projectId);
        if (!row) return null;
        return {
          id: text(row["id"]),
          projectId: text(row["project_id"]),
          name: text(row["name"]),
          description: text(row["description"]),
          industry: text(row["industry"]),
          positioning: text(row["positioning"]) as Positioning,
          targetCustomer: text(row["target_customer"]),
          personality: fromJson<string[]>(row["personality"], []),
          promise: text(row["promise"]),
          mission: text(row["mission"]),
          vision: text(row["vision"]),
          slogan: text(row["slogan"]),
          toneOfVoice: text(row["tone_of_voice"]),
          brandStory: text(row["brand_story"]),
          nameAlternatives: fromJson<string[]>(row["name_alternatives"], []),
          createdAt: text(row["created_at"]),
        };
      },
    },

    identities: {
      save(projectId, identity) {
        const now = nowIso();
        const existing = get(`SELECT id, created_at FROM brand_identities WHERE project_id = ?`, projectId);
        const id = existing ? text(existing["id"]) : newId("asset");

        run(
          `INSERT INTO brand_identities (id,project_id,palette,typography,logo_brief,logo_url,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT(project_id) DO UPDATE SET
             palette=excluded.palette, typography=excluded.typography,
             logo_brief=excluded.logo_brief, logo_url=excluded.logo_url,
             updated_at=excluded.updated_at`,
          id, projectId, toJson(identity.palette), toJson(identity.typography),
          identity.logoBrief, identity.logoUrl ?? null, now, now,
        );

        return {
          ...identity,
          id,
          projectId,
          createdAt: existing ? text(existing["created_at"]) : now,
          updatedAt: now,
        };
      },

      findForProject(projectId) {
        const row = get(`SELECT * FROM brand_identities WHERE project_id = ?`, projectId);
        if (!row) return null;
        return {
          id: text(row["id"]),
          projectId: text(row["project_id"]),
          palette: fromJson<ColorSwatch[]>(row["palette"], []),
          typography: fromJson<Typography>(row["typography"], {
            primary: "Inter",
            secondary: "Inter",
            primaryFallback: "sans-serif",
            secondaryFallback: "sans-serif",
            rationale: "",
          }),
          logoBrief: text(row["logo_brief"]),
          logoUrl: optionalText(row["logo_url"]),
          createdAt: text(row["created_at"]),
          updatedAt: text(row["updated_at"]),
        };
      },
    },

    quotes: {
      create(input) {
        const now = nowIso();
        const id = newId("quote");
        run(
          `INSERT INTO quotes
             (id,project_id,user_id,reference,currency,line_items,subtotal,shipping,fees,total,margin,status,valid_until,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          id, input.projectId, input.userId, input.reference, input.currency, toJson(input.lineItems),
          input.subtotal, input.shipping, input.fees, input.total, input.margin, "draft",
          input.validUntil, now,
        );
        const row = get(`SELECT * FROM quotes WHERE id = ?`, id);
        if (!row) throw new Error("quote vanished immediately after insert");
        return toQuote(row);
      },

      findForOwner(id, userId) {
        const row = get(`SELECT * FROM quotes WHERE id = ? AND user_id = ?`, id, userId);
        return row ? toQuote(row) : null;
      },

      listForOwner(userId) {
        return all(`SELECT * FROM quotes WHERE user_id = ? ORDER BY created_at DESC`, userId).map(toQuote);
      },

      setStatus(id, status) {
        run(`UPDATE quotes SET status = ? WHERE id = ?`, status, id);
      },

      findAsAdmin(id) {
        const row = get(`SELECT * FROM quotes WHERE id = ?`, id);
        if (!row) return null;
        const quote = toQuote(row);
        return { ...quote, margin: readMoney(row["margin"], quote.currency) };
      },

      listAsAdmin(limit = 100) {
        return all(`SELECT * FROM quotes ORDER BY created_at DESC LIMIT ?`, limit).map((row) => {
          const quote = toQuote(row);
          return { ...quote, margin: readMoney(row["margin"], quote.currency) };
        });
      },
    },

    orders: {
      create(input) {
        const now = nowIso();
        const id = newId("order");
        run(
          `INSERT INTO orders
             (id,user_id,project_id,quote_id,reference,payment_status,fulfillment_status,total,currency,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          id, input.userId, input.projectId, input.quoteId, input.reference,
          "unpaid", "pending", input.total, input.currency, now, now,
        );
        const row = get(`SELECT * FROM orders WHERE id = ?`, id);
        if (!row) throw new Error("order vanished immediately after insert");
        return toOrder(row);
      },

      findForOwner(id, userId) {
        const row = get(`SELECT * FROM orders WHERE id = ? AND user_id = ?`, id, userId);
        return row ? toOrder(row) : null;
      },

      listForOwner(userId) {
        return all(`SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC`, userId).map(toOrder);
      },

      setPaymentStatus(id, status) {
        run(`UPDATE orders SET payment_status = ?, updated_at = ? WHERE id = ?`, status, nowIso(), id);
      },

      setFulfillmentStatus(id, status) {
        run(`UPDATE orders SET fulfillment_status = ?, updated_at = ? WHERE id = ?`, status, nowIso(), id);
      },

      addEvent(orderId, kind, actor, detail) {
        run(
          `INSERT INTO order_events (id,order_id,at,kind,detail,actor) VALUES (?,?,?,?,?,?)`,
          newId("notification"), orderId, nowIso(), kind, detail ?? null, actor,
        );
      },

      events(orderId) {
        return all(`SELECT * FROM order_events WHERE order_id = ? ORDER BY at ASC`, orderId).map((row) => ({
          at: text(row["at"]),
          kind: text(row["kind"]),
          actor: text(row["actor"]),
          detail: optionalText(row["detail"]),
        }));
      },

      findAsAdmin(id) {
        const row = get(`SELECT * FROM orders WHERE id = ?`, id);
        return row ? toOrder(row) : null;
      },

      listAsAdmin(limit = 100) {
        return all(`SELECT * FROM orders ORDER BY created_at DESC LIMIT ?`, limit).map(toOrder);
      },
    },
  };
}

/** Convenience for the brand result screen: everything one project owns. */
export interface ProjectBundle {
  project: ProjectRow;
  interview: InterviewRow | null;
  strategy: StrategyRow | null;
  identity: IdentityRow | null;
}

export function loadProjectBundle(
  repos: Repositories,
  projectId: string,
  userId: string,
): ProjectBundle | null {
  const project = repos.projects.findForOwner(projectId, userId);
  if (!project) return null;
  return {
    project,
    interview: repos.interviews.findForProject(projectId),
    strategy: repos.strategies.findForProject(projectId),
    identity: repos.identities.findForProject(projectId),
  };
}

/** Shape a stored strategy and identity back into a BrandProfile for the engine. */
export function toBrandProfile(bundle: ProjectBundle): BrandProfile | null {
  const { project, strategy, identity } = bundle;
  if (!strategy || !identity) return null;
  return {
    id: project.id,
    userId: project.userId,
    name: strategy.name,
    description: strategy.description,
    industry: strategy.industry,
    targetCustomer: strategy.targetCustomer,
    positioning: strategy.positioning,
    personality: strategy.personality,
    promise: strategy.promise,
    mission: strategy.mission,
    vision: strategy.vision,
    slogan: strategy.slogan,
    toneOfVoice: strategy.toneOfVoice,
    brandStory: strategy.brandStory,
    palette: identity.palette,
    typography: identity.typography,
    logoBrief: identity.logoBrief,
    status: project.status === "archived" ? "archived" : "generated",
    locale: "en",
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}
