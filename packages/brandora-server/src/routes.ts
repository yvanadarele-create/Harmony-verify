/**
 * Brandora's API.
 *
 * The whole customer journey is here, in the order a founder walks it:
 *
 *   sign up → project → interview → generate → brand → catalogue →
 *   package → quote → checkout → order → dashboard
 *
 * Three rules run through every handler and are worth stating once rather than
 * repeating in each comment.
 *
 * **The session names the user.** No route reads a `userId` from a body or a
 * query string. `requireUser` returns the row the session cookie resolved to,
 * and that id is what goes into the `WHERE` clause. There is therefore no
 * request shape that lets someone act as another account.
 *
 * **Ownership is a filter, not a check.** Reads use `findForOwner(id, userId)`,
 * so another customer's project is *not found* rather than *found and refused*.
 * A 403 confirms the id exists, which is precisely what someone enumerating ids
 * is trying to learn.
 *
 * **Money is recomputed, never accepted.** Package routes take product ids and
 * quantities. Quote routes price from the catalogue. Checkout reads the amount
 * from the stored quote. Nothing here parses a price out of a request body,
 * because no handler has a line that could.
 */

import {
  type BrandoraProduct,
  NotFoundError,
  ValidationError,
  add,
  formatMoney,
  money,
  multiply,
  sum,
  toMajor,
} from "@brandora/shared";
import {
  INTERVIEW_QUESTIONS,
  type InterviewAnswer,
  type RegenerableField,
  REGENERABLE_FIELDS,
  type StrategyProvider,
  brandKitManifest,
  buildBrief,
  buildGuidelines,
  derivePalette,
  deriveTypography,
  buildLogoBrief,
} from "@brandora/brand-engine";
import { generateBrandWithRetry, regenerateField } from "@brandora/ai";
import { CATALOG, filterProducts } from "@brandora/catalog";
import {
  type Repositories,
  type UserRow,
  loadProjectBundle,
  toBrandProfile,
} from "@brandora/database";
import {
  MIN_PASSWORD_LENGTH,
  assertPasswordAcceptable,
  hashPassword,
  newSessionToken,
  sessionExpiry,
  verifyPassword,
  wasteVerificationTime,
} from "@brandora/auth";
import { DEFAULT_VALIDITY_DAYS, quoteReference } from "@brandora/quotes";
import { aliexpressIntegrationStatus, paystackIntegrationStatus } from "@brandora/config";

import {
  type HttpResult,
  RateLimitedError,
  RateLimiter,
  Router,
  type ServerLogger,
  json,
  optionalString,
  requireArray,
  requireInteger,
  requireString,
  signValue,
} from "./http.js";
import { type PricingSettings, priceProject, recommendProducts } from "./pricing.js";
import {
  type PaymentProvider,
  assertAmountMatches,
  paymentReference,
} from "./payments.js";
import {
  SESSION_COOKIE,
  type SessionContext,
  publicUser,
  requireAdmin,
  requireUser,
} from "./session.js";

export interface ServerDeps {
  repos: Repositories;
  authSecret: string;
  /** Generates brand strategy. Unconfigured providers fail loudly, never fake. */
  strategy: StrategyProvider;
  payments: PaymentProvider;
  pricing: PricingSettings;
  publicBaseUrl: string;
  logger: ServerLogger;
  catalog?: readonly BrandoraProduct[];
  now?: () => Date;
  /** Overridden in tests, where every request shares one address. */
  rateLimits?: Partial<RateLimits>;
  /** The environment as the admin integrations page should read it. */
  env?: Record<string, string | undefined>;
}

const SESSION_MAX_AGE = 60 * 60 * 24 * 14;

export interface RateLimits {
  loginsPerWindow: number;
  loginWindowMs: number;
  signupsPerWindow: number;
  signupWindowMs: number;
  generationsPerWindow: number;
  generationWindowMs: number;
}

/**
 * Deliberately loose on the address-keyed limits.
 *
 * Brandora's customers reach it over West African mobile networks, where
 * carrier-grade NAT puts thousands of people behind one address. A limit tuned
 * as though an IP were a person locks out a whole city block the moment a few
 * founders sign up in the same hour — the failure looks like an outage and is
 * invisible in the logs. Password guessing is throttled hard because a login
 * attempt is cheap to repeat; account creation is throttled gently because a
 * false positive there costs a customer.
 *
 * The generation limit is keyed on the user id, not the address, because it
 * protects a paid API rather than an account.
 */
export const DEFAULT_RATE_LIMITS: RateLimits = {
  loginsPerWindow: 20,
  loginWindowMs: 10 * 60 * 1000,
  signupsPerWindow: 40,
  signupWindowMs: 60 * 60 * 1000,
  generationsPerWindow: 12,
  generationWindowMs: 60 * 60 * 1000,
};

/* --- Presentation helpers -------------------------------------------------- */

/**
 * How money crosses the wire.
 *
 * Both the integer and a formatted string, because the browser must never do
 * currency arithmetic — it has no idea XOF is zero-decimal, and a front end
 * that divides by 100 turns 15 000 FCFA into 150.
 */
const asMoney = (value: { amount: number; currency: string }) => ({
  amount: value.amount,
  currency: value.currency,
  major: toMajor(value as never),
  display: formatMoney(value as never),
});

const productView = (product: BrandoraProduct) => ({
  id: product.id,
  name: product.name,
  category: product.category,
  subcategory: product.subcategory,
  description: product.description,
  images: product.images,
  material: product.material ?? null,
  colors: product.colors,
  minimumQuantity: product.minimumQuantity,
  availableQuantity: product.availableQuantity,
  unitPrice: asMoney(product.indicativeUnitPrice),
  weightG: product.dimensions?.weightG ?? null,
  featured: product.featured,
  customization: {
    confidence: product.customization.confidence,
    methods: product.customization.methods,
    unitCost: product.customization.unitCost ? asMoney(product.customization.unitCost) : null,
    setupCost: product.customization.setupCost ? asMoney(product.customization.setupCost) : null,
    minimumUnits: product.customization.minimumUnits ?? null,
    notes: product.customization.notes ?? null,
    // §36: a claim only when there is evidence behind it.
    canCarryLogo: product.customization.confidence === "verified",
    label:
      product.customization.confidence === "verified"
        ? "Confirmed: carries your logo"
        : product.customization.confidence === "reported"
          ? "Supplier reports branding — we confirm before you pay"
          : product.customization.confidence === "unavailable"
            ? "Cannot be branded"
            : "Branding not confirmed yet",
  },
  /**
   * §38: no invented dates. The catalogue carries no carrier estimate, so the
   * field is explicitly null and the interface says so rather than guessing.
   */
  deliveryEstimate: null as string | null,
});

/* --- The router ------------------------------------------------------------ */

export function createRouter(deps: ServerDeps): Router {
  const router = new Router();
  const repos = deps.repos;
  const catalog = deps.catalog ?? CATALOG;
  const now = deps.now ?? (() => new Date());
  const session: SessionContext = { repos, authSecret: deps.authSecret };

  const limits: RateLimits = { ...DEFAULT_RATE_LIMITS, ...(deps.rateLimits ?? {}) };
  const loginLimiter = new RateLimiter(limits.loginsPerWindow, limits.loginWindowMs);
  const signupLimiter = new RateLimiter(limits.signupsPerWindow, limits.signupWindowMs);
  const generateLimiter = new RateLimiter(limits.generationsPerWindow, limits.generationWindowMs);

  const byId = new Map(catalog.map((p) => [p.id, p]));

  /** Load a project the caller owns, or 404. */
  const ownedProject = (ctx: { params: Record<string, string> }, user: UserRow) => {
    const id = ctx.params["id"] ?? "";
    const project = repos.projects.findForOwner(id, user.id);
    if (!project) throw new NotFoundError("project", id);
    return project;
  };

  const setSessionCookie = (userId: string): HttpResult["cookies"] => {
    const token = newSessionToken();
    repos.sessions.create(userId, token, sessionExpiry(now()));
    return [
      { name: SESSION_COOKIE, value: signValue(token, deps.authSecret), maxAgeSeconds: SESSION_MAX_AGE },
    ];
  };

  /* --- Health and reference data ----------------------------------------- */

  router.get("/api/health", () =>
    json(200, {
      status: "ok",
      time: now().toISOString(),
      payments: deps.payments.configured ? deps.payments.name : "not-configured",
    }),
  );

  // Public: the interview is the front door, and a visitor sees it before they
  // have an account.
  router.get("/api/interview/questions", () =>
    json(200, {
      questions: INTERVIEW_QUESTIONS.map((q) => ({
        field: q.field,
        prompt: q.prompt,
        because: q.because,
        helpPrompt: q.helpPrompt,
        examples: q.examples,
        kind: q.kind,
        options: q.options ?? [],
        required: q.required,
      })),
    }),
  );

  /* --- Authentication ----------------------------------------------------- */

  router.post("/api/auth/signup", (ctx) => {
    if (signupLimiter.exceeded(ctx.ip)) {
      throw new RateLimitedError(`signup rate limit from ${ctx.ip}`);
    }

    const email = requireString(ctx.body, "email", 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      throw new ValidationError("email", "does not look like an email address");
    }
    const name = requireString(ctx.body, "name", 120);
    const password = requireString(ctx.body, "password", 512);
    assertPasswordAcceptable(password);

    // Deliberately the same response as a successful signup would produce is
    // *not* attempted here: an account creation form must tell you the address
    // is taken, or you cannot proceed. The enumeration defence lives on login,
    // where it costs the user nothing.
    if (repos.users.findByEmail(email)) {
      throw new ValidationError("email", "an account already exists for this address");
    }

    const locale = optionalString(ctx.body, "locale", 5);
    const country = optionalString(ctx.body, "country", 80);
    const phone = optionalString(ctx.body, "phone", 40);

    const user = repos.users.create({
      email,
      name,
      role: "customer",
      ...(locale === "fr" || locale === "es" ? { locale } : {}),
      ...(country ? { country } : {}),
      ...(phone ? { phone } : {}),
    });

    const record = hashPassword(password);
    repos.users.setCredentials(user.id, record.hash, record.salt);

    return json(201, { user: publicUser(user) }, { cookies: setSessionCookie(user.id) });
  });

  router.post("/api/auth/login", (ctx) => {
    if (loginLimiter.exceeded(ctx.ip)) {
      throw new RateLimitedError(`login rate limit from ${ctx.ip}`);
    }

    const email = requireString(ctx.body, "email", 254);
    const password = requireString(ctx.body, "password", 512);

    const user = repos.users.findByEmail(email);
    const credentials = user ? repos.users.credentialsFor(user.id) : null;

    if (!user || !credentials) {
      // Burn the same work a real verification costs, so the response time does
      // not tell an attacker which addresses have accounts.
      wasteVerificationTime();
      throw new ValidationError("credentials", `no account for ${email}`);
    }

    const ok = verifyPassword(password, {
      hash: credentials.passwordHash,
      salt: credentials.passwordSalt,
    });
    if (!ok) throw new ValidationError("credentials", `bad password for ${user.id}`);

    loginLimiter.reset(ctx.ip);
    return json(200, { user: publicUser(user) }, { cookies: setSessionCookie(user.id) });
  });

  router.post("/api/auth/logout", (ctx) => {
    const user = requireUser(ctx, session);
    // Every session, not just this cookie: "log out" on a shared phone should
    // mean it, and a single-device logout is the surprising behaviour here.
    repos.sessions.destroyAllFor(user.id);
    return json(200, { ok: true }, { cookies: [{ name: SESSION_COOKIE, value: "", clear: true }] });
  });

  router.get("/api/auth/me", (ctx) => {
    const user = requireUser(ctx, session);
    return json(200, { user: publicUser(user) });
  });

  router.get("/api/auth/password-policy", () =>
    json(200, { minimumLength: MIN_PASSWORD_LENGTH }),
  );

  /* --- Projects ----------------------------------------------------------- */

  router.get("/api/projects", (ctx) => {
    const user = requireUser(ctx, session);
    const projects = repos.projects.listForOwner(user.id);
    return json(200, {
      projects: projects.map((project) => {
        const strategy = repos.strategies.findForProject(project.id);
        const identity = repos.identities.findForProject(project.id);
        const items = repos.packages.listForProject(project.id);
        return {
          ...project,
          brandName: strategy?.name ?? null,
          slogan: strategy?.slogan ?? null,
          palette: identity?.palette ?? null,
          packageItems: items.length,
          // What "Resume" should do, computed here so every surface agrees.
          nextStep: nextStepFor(project.status, !!strategy, items.length),
        };
      }),
    });
  });

  router.post("/api/projects", (ctx) => {
    const user = requireUser(ctx, session);
    const name = requireString(ctx.body, "name", 120);
    const project = repos.projects.create(user.id, name);
    return json(201, { project });
  });

  router.get("/api/projects/:id", (ctx) => {
    const user = requireUser(ctx, session);
    const project = ownedProject(ctx, user);
    const bundle = loadProjectBundle(repos, project.id, user.id);
    if (!bundle) throw new NotFoundError("project", project.id);

    const items = repos.packages.listForProject(project.id);
    return json(200, {
      project: bundle.project,
      interview: bundle.interview,
      strategy: bundle.strategy,
      identity: bundle.identity,
      packageItems: items.length,
      quotes: repos.quotes.listForProject(project.id, user.id).map(quoteView),
      nextStep: nextStepFor(project.status, !!bundle.strategy, items.length),
    });
  });

  router.patch("/api/projects/:id", (ctx) => {
    const user = requireUser(ctx, session);
    const project = ownedProject(ctx, user);
    const name = requireString(ctx.body, "name", 120);
    repos.projects.rename(project.id, user.id, name);
    return json(200, { project: repos.projects.findForOwner(project.id, user.id) });
  });

  /* --- Interview ---------------------------------------------------------- */

  router.put("/api/projects/:id/interview", (ctx) => {
    const user = requireUser(ctx, session);
    const project = ownedProject(ctx, user);

    const answers = readAnswers(ctx.body);
    const complete = isComplete(answers);

    const row = repos.interviews.save(project.id, { answers }, complete);
    repos.projects.setStatus(project.id, user.id, complete ? "interviewing" : "draft");

    return json(200, { interview: row, complete });
  });

  router.get("/api/projects/:id/interview", (ctx) => {
    const user = requireUser(ctx, session);
    const project = ownedProject(ctx, user);
    const row = repos.interviews.findForProject(project.id);
    return json(200, { interview: row });
  });

  /* --- Generation --------------------------------------------------------- */

  router.post("/api/projects/:id/generate", async (ctx) => {
    const user = requireUser(ctx, session);
    const project = ownedProject(ctx, user);

    if (generateLimiter.exceeded(user.id)) {
      throw new RateLimitedError(`generation rate limit for ${user.id}`);
    }

    const stored = repos.interviews.findForProject(project.id);
    if (!stored) throw new ValidationError("interview", "finish the interview first");

    const answers = readAnswers(stored.responses);
    const existingName = optionalString(ctx.body, "existingName", 120);
    const variation = typeof ctx.body["variation"] === "number" ? ctx.body["variation"] : 0;

    const result = await generateBrandWithRetry(deps.strategy, {
      userId: user.id,
      answers,
      locale: user.locale,
      ...(existingName ? { existingName } : {}),
      variation,
      brandId: project.id,
      now: now(),
    });

    repos.strategies.save(
      project.id,
      {
        name: result.strategy.name,
        description: result.strategy.description,
        industry: result.strategy.industry,
        positioning: result.strategy.positioning,
        targetCustomer: result.strategy.targetCustomer,
        personality: result.strategy.personality,
        promise: result.strategy.promise,
        mission: result.strategy.mission,
        vision: result.strategy.vision,
        slogan: result.strategy.slogan,
        toneOfVoice: result.strategy.toneOfVoice,
        brandStory: result.strategy.brandStory,
        nameAlternatives: result.strategy.nameAlternatives,
      },
      result.raw,
    );

    repos.identities.save(project.id, {
      palette: result.profile.palette,
      typography: result.profile.typography,
      logoBrief: result.profile.logoBrief,
    });

    repos.projects.setStatus(project.id, user.id, "generated");
    if (project.name === "Untitled brand" || project.name.trim() === "") {
      repos.projects.rename(project.id, user.id, result.strategy.name);
    }

    return json(201, { strategy: result.strategy, identity: identityView(result.profile) });
  });

  router.post("/api/projects/:id/regenerate", async (ctx) => {
    const user = requireUser(ctx, session);
    const project = ownedProject(ctx, user);

    if (generateLimiter.exceeded(user.id)) {
      throw new RateLimitedError(`regeneration rate limit for ${user.id}`);
    }

    const field = requireString(ctx.body, "field", 40);
    if (!(REGENERABLE_FIELDS as readonly string[]).includes(field)) {
      throw new ValidationError("field", `expected one of ${REGENERABLE_FIELDS.join(", ")}`);
    }

    const stored = repos.strategies.findForProject(project.id);
    const interview = repos.interviews.findForProject(project.id);
    if (!stored || !interview) throw new ValidationError("strategy", "generate a brand first");

    const brief = buildBrief(readAnswers(interview.responses), user.locale);
    const updated = await regenerateField(
      deps.strategy,
      brief,
      {
        name: stored.name,
        description: stored.description,
        industry: stored.industry,
        targetCustomer: stored.targetCustomer,
        positioning: stored.positioning,
        personality: stored.personality,
        promise: stored.promise,
        mission: stored.mission,
        vision: stored.vision,
        slogan: stored.slogan,
        toneOfVoice: stored.toneOfVoice,
        brandStory: stored.brandStory,
        nameAlternatives: stored.nameAlternatives,
      },
      field as RegenerableField,
    );

    repos.strategies.save(project.id, { ...updated }, updated);
    return json(200, { strategy: updated });
  });

  /**
   * Re-derive the palette without touching the words (§18).
   *
   * The variation is a seed, so "show me another" is reproducible rather than
   * random — a founder who liked the third one can get it back.
   */
  router.post("/api/projects/:id/identity/regenerate", (ctx) => {
    const user = requireUser(ctx, session);
    const project = ownedProject(ctx, user);

    const interview = repos.interviews.findForProject(project.id);
    const strategy = repos.strategies.findForProject(project.id);
    if (!interview || !strategy) throw new ValidationError("identity", "generate a brand first");

    const variation = requireInteger(ctx.body, "variation", 0, 99);
    const brief = buildBrief(readAnswers(interview.responses), user.locale);
    const palette = derivePalette(brief, { variation });
    const typography = deriveTypography(brief);

    const saved = repos.identities.save(project.id, {
      palette,
      typography,
      logoBrief: buildLogoBrief(brief, palette, typography, strategy.name),
    });

    return json(200, { identity: saved });
  });

  /* --- The brand ---------------------------------------------------------- */

  router.get("/api/projects/:id/brand", (ctx) => {
    const user = requireUser(ctx, session);
    const project = ownedProject(ctx, user);
    const bundle = loadProjectBundle(repos, project.id, user.id);
    if (!bundle) throw new NotFoundError("project", project.id);

    const profile = toBrandProfile(bundle);
    if (!profile) throw new NotFoundError("brand", project.id);

    return json(200, {
      brand: profile,
      kit: brandKitManifest(profile),
      guidelines: buildGuidelines(profile),
      nameAlternatives: bundle.strategy?.nameAlternatives ?? [],
    });
  });

  router.get("/api/projects/:id/brand/guidelines", (ctx) => {
    const user = requireUser(ctx, session);
    const project = ownedProject(ctx, user);
    const bundle = loadProjectBundle(repos, project.id, user.id);
    const profile = bundle ? toBrandProfile(bundle) : null;
    if (!profile) throw new NotFoundError("brand", project.id);

    return {
      status: 200,
      raw: buildGuidelines(profile),
      contentType: "text/markdown; charset=utf-8",
      headers: {
        "Content-Disposition": `attachment; filename="${profile.name.replace(/[^\w-]+/g, "-")}-guidelines.md"`,
      },
    };
  });

  /* --- Catalogue ---------------------------------------------------------- */

  router.get("/api/catalog", (ctx) => {
    const quantityRaw = ctx.query.get("quantity");
    const quantity = quantityRaw ? Number(quantityRaw) : undefined;
    const category = ctx.query.get("category") ?? undefined;
    const search = ctx.query.get("q") ?? undefined;
    const customizable = ctx.query.get("customizable") === "true";

    const result = filterProducts(
      {
        ...(category && category !== "all" ? { category: category as never } : {}),
        ...(search ? { search } : {}),
        ...(quantity && Number.isFinite(quantity) ? { quantity } : {}),
        ...(customizable ? { customizableOnly: true } : {}),
      },
      catalog,
    );

    return json(200, {
      products: result.matches.map(productView),
      // §35: shown under their own heading rather than dropped. "We have this,
      // but not at thirty" is the sentence that teaches a founder that fifty
      // units unlocks a better shelf.
      nearMisses: result.nearMisses.map(productView),
      total: catalog.length,
    });
  });

  router.get("/api/catalog/:productId", (ctx) => {
    const product = byId.get(ctx.params["productId"] ?? "");
    if (!product) throw new NotFoundError("product", ctx.params["productId"] ?? "");
    return json(200, { product: productView(product) });
  });

  router.get("/api/projects/:id/recommendations", (ctx) => {
    const user = requireUser(ctx, session);
    const project = ownedProject(ctx, user);
    const strategy = repos.strategies.findForProject(project.id);
    if (!strategy) throw new ValidationError("strategy", "generate a brand first");

    const quantityRaw = Number(ctx.query.get("quantity") ?? 25);
    const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? Math.floor(quantityRaw) : 25;

    const ranked = recommendProducts(
      {
        positioning: strategy.positioning,
        personality: strategy.personality,
        industry: `${strategy.industry} ${strategy.description}`,
        quantity,
      },
      catalog,
    );

    return json(200, {
      quantity,
      recommendations: ranked.map((entry) => ({
        product: productView(entry.product),
        score: entry.score,
        reasons: entry.reasons,
      })),
    });
  });

  /* --- The package -------------------------------------------------------- */

  const packageResponse = (projectId: string) => {
    const items = repos.packages.listForProject(projectId);
    if (items.length === 0) {
      return { items: [], totals: null, adjustments: [], currency: deps.pricing.currency };
    }

    const priced = priceProject(
      items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        ...(item.customizationMethod ? { customizationMethod: item.customizationMethod } : {}),
      })),
      catalog,
      deps.pricing,
    );

    return {
      currency: deps.pricing.currency,
      items: items.map((item) => {
        const product = byId.get(item.productId);
        const line = priced.lines.find((l) => l.productId === item.productId);
        return {
          id: item.id,
          productId: item.productId,
          name: product?.name ?? item.productId,
          image: product?.images[0] ?? null,
          quantity: item.quantity,
          chargedQuantity: line?.quantity ?? item.quantity,
          customizationMethod: item.customizationMethod || null,
          unitPrice: product ? asMoney(product.indicativeUnitPrice) : null,
          lineTotal: line ? asMoney(add(line.productsTotal, line.customizationTotal)) : null,
        };
      }),
      totals: {
        products: asMoney(priced.productsTotal),
        customization: asMoney(priced.customizationTotal),
        shipping: asMoney(priced.shippingTotal),
        logistics: asMoney(priced.logisticsTotal),
        service: asMoney(priced.serviceTotal),
        total: asMoney(priced.total),
        unitCount: priced.unitCount,
      },
      adjustments: priced.adjustments,
    };
  };

  router.get("/api/projects/:id/package", (ctx) => {
    const user = requireUser(ctx, session);
    const project = ownedProject(ctx, user);
    return json(200, packageResponse(project.id));
  });

  router.post("/api/projects/:id/package/items", (ctx) => {
    const user = requireUser(ctx, session);
    const project = ownedProject(ctx, user);

    const productId = requireString(ctx.body, "productId", 80);
    const product = byId.get(productId);
    if (!product) throw new ValidationError("productId", `unknown product ${productId}`);

    const quantity = requireInteger(ctx.body, "quantity", 1, 1_000_000);
    const method = optionalString(ctx.body, "customizationMethod", 40);

    // §36 again, this time at the write: a method Brandora has not confirmed
    // cannot be attached to a line, so it can never reach a quote.
    if (method) {
      const offered = (product.customization.methods as readonly string[]).includes(method);
      if (!offered || product.customization.confidence !== "verified") {
        throw new ValidationError("customizationMethod", `${product.name} does not offer confirmed ${method}`);
      }
    }

    repos.packages.add(project.id, productId, quantity, method ?? "");
    return json(201, packageResponse(project.id));
  });

  router.patch("/api/projects/:id/package/items/:itemId", (ctx) => {
    const user = requireUser(ctx, session);
    const project = ownedProject(ctx, user);
    const quantity = requireInteger(ctx.body, "quantity", 1, 1_000_000);
    // Scoped to the project: an item id belonging to someone else's package
    // updates nothing rather than updating theirs.
    repos.packages.setQuantity(project.id, ctx.params["itemId"] ?? "", quantity);
    return json(200, packageResponse(project.id));
  });

  router.delete("/api/projects/:id/package/items/:itemId", (ctx) => {
    const user = requireUser(ctx, session);
    const project = ownedProject(ctx, user);
    repos.packages.remove(project.id, ctx.params["itemId"] ?? "");
    return json(200, packageResponse(project.id));
  });

  router.delete("/api/projects/:id/package", (ctx) => {
    const user = requireUser(ctx, session);
    const project = ownedProject(ctx, user);
    repos.packages.clear(project.id);
    return json(200, packageResponse(project.id));
  });

  /* --- Quotes -------------------------------------------------------------- */

  router.post("/api/projects/:id/quote", (ctx) => {
    const user = requireUser(ctx, session);
    const project = ownedProject(ctx, user);

    const items = repos.packages.listForProject(project.id);
    if (items.length === 0) throw new ValidationError("package", "add a product first");

    const priced = priceProject(
      items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        ...(item.customizationMethod ? { customizationMethod: item.customizationMethod } : {}),
      })),
      catalog,
      deps.pricing,
    );

    const issuedAt = now();
    const validUntil = new Date(issuedAt.getTime());
    validUntil.setUTCDate(validUntil.getUTCDate() + DEFAULT_VALIDITY_DAYS);

    const currency = deps.pricing.currency;
    const fees = sum([priced.logisticsTotal, priced.serviceTotal], currency);
    const subtotal = add(priced.productsTotal, priced.customizationTotal);

    // Margin is stored, never returned by a customer-facing read (§39). It is
    // written here so an admin can see it later; the quote view below has no
    // field it could travel in.
    const margin = multiply(subtotal, deps.pricing.serviceRate);

    const quote = insertQuoteWithUniqueReference(repos, issuedAt, {
      projectId: project.id,
      userId: user.id,
      currency,
      lineItems: priced.lines.map((line) => ({
        productId: line.productId,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice.amount,
        total: add(line.productsTotal, line.customizationTotal).amount,
      })),
      subtotal: subtotal.amount,
      shipping: priced.shippingTotal.amount,
      fees: fees.amount,
      total: priced.total.amount,
      margin: margin.amount,
      validUntil: validUntil.toISOString(),
    });

    repos.projects.setStatus(project.id, user.id, "active");
    return json(201, { quote: quoteView(quote) });
  });

  router.get("/api/quotes", (ctx) => {
    const user = requireUser(ctx, session);
    return json(200, { quotes: repos.quotes.listForOwner(user.id).map(quoteView) });
  });

  router.get("/api/quotes/:id", (ctx) => {
    const user = requireUser(ctx, session);
    const quote = repos.quotes.findForOwner(ctx.params["id"] ?? "", user.id);
    if (!quote) throw new NotFoundError("quote", ctx.params["id"] ?? "");
    return json(200, { quote: quoteView(quote) });
  });

  /* --- Checkout ------------------------------------------------------------ */

  /**
   * Turn a quote into an order and start a payment.
   *
   * The request body carries no amount — there is nowhere to put one. The
   * charge is `quote.total` as stored, and that same figure is written to the
   * `payments` row so verification has something to compare against that the
   * customer never touched.
   */
  router.post("/api/quotes/:id/checkout", async (ctx) => {
    const user = requireUser(ctx, session);
    const quoteId = ctx.params["id"] ?? "";
    const quote = repos.quotes.findForOwner(quoteId, user.id);
    if (!quote) throw new NotFoundError("quote", quoteId);

    if (quote.status === "rejected" || quote.status === "expired") {
      throw new ValidationError("quote", `quote ${quote.reference} is ${quote.status}`);
    }
    if (new Date(quote.validUntil).getTime() < now().getTime()) {
      repos.quotes.setStatus(quote.id, "expired");
      throw new ValidationError("quote", `quote ${quote.reference} expired on ${quote.validUntil}`);
    }

    const issuedAt = now();
    const order = insertOrderWithUniqueReference(repos, issuedAt, {
      userId: user.id,
      projectId: quote.projectId,
      quoteId: quote.id,
      total: quote.total.amount,
      currency: quote.currency,
    });

    repos.quotes.setStatus(quote.id, "approved");
    repos.orders.addEvent(order.id, "created", `customer:${user.id}`, `from quote ${quote.reference}`);

    const reference = paymentReference(order.reference, repos.payments.listForOrder(order.id).length + 1);
    repos.payments.create({
      orderId: order.id,
      provider: deps.payments.name,
      reference,
      amount: quote.total.amount,
      currency: quote.currency,
    });

    const intent = await deps.payments.initialise({
      reference,
      amount: quote.total,
      email: user.email,
      callbackUrl: `${deps.publicBaseUrl}/order?ref=${encodeURIComponent(order.reference)}`,
    });

    if (deps.payments.configured) {
      repos.orders.setPaymentStatus(order.id, "pending");
      repos.orders.addEvent(order.id, "payment-initialised", "system", `${deps.payments.name} ${reference}`);
    } else {
      // No provider: the order is real and awaiting an arranged payment. It is
      // never marked paid by anything on this path.
      repos.orders.setPaymentStatus(order.id, "pending");
      repos.orders.addEvent(order.id, "payment-manual", "system", "awaiting arranged payment");
    }

    return json(201, {
      order: orderView(repos.orders.findForOwner(order.id, user.id) ?? order),
      payment: {
        reference: intent.reference,
        authorizationUrl: intent.authorizationUrl,
        instruction: intent.instruction,
        provider: intent.provider,
        configured: deps.payments.configured,
      },
    });
  });

  /**
   * Confirm a payment with the provider.
   *
   * Called on return from the payment page. The amount comparison is the point:
   * whatever the provider reports must equal what Brandora recorded when the
   * charge was created, or the payment is marked `mismatch` and the order stays
   * unpaid.
   */
  router.post("/api/orders/:id/verify", async (ctx) => {
    const user = requireUser(ctx, session);
    const order = repos.orders.findForOwner(ctx.params["id"] ?? "", user.id);
    if (!order) throw new NotFoundError("order", ctx.params["id"] ?? "");

    const attempts = repos.payments.listForOrder(order.id);
    const pending = attempts.find((p) => p.status === "initialised") ?? attempts[0];
    if (!pending) throw new ValidationError("payment", "no payment has been started for this order");

    if (pending.status === "paid") {
      return json(200, { order: orderView(order), payment: paymentView(pending) });
    }

    const result = await deps.payments.verify(pending.reference);

    if (!result.paid) {
      return json(200, {
        order: orderView(order),
        payment: { ...paymentView(pending), providerStatus: result.providerStatus },
        settled: false,
      });
    }

    // Throws AmountMismatchError, which is a 409 the customer sees as a generic
    // failure and the admin sees with both figures in the log.
    try {
      assertAmountMatches(pending.amount, result.amount);
    } catch (err) {
      repos.payments.markStatus(pending.reference, "mismatch");
      repos.orders.addEvent(order.id, "payment-mismatch", "system", pending.reference);
      throw err;
    }

    repos.payments.markPaid(pending.reference, now().toISOString());
    repos.orders.setPaymentStatus(order.id, "paid");
    repos.orders.setFulfillmentStatus(order.id, "confirmed");
    repos.orders.addEvent(order.id, "paid", "system", pending.reference);

    const settled = repos.orders.findForOwner(order.id, user.id);
    return json(200, {
      order: orderView(settled ?? order),
      payment: paymentView(repos.payments.findByReference(pending.reference) ?? pending),
      settled: true,
    });
  });

  /* --- Orders -------------------------------------------------------------- */

  router.get("/api/orders", (ctx) => {
    const user = requireUser(ctx, session);
    return json(200, { orders: repos.orders.listForOwner(user.id).map(orderView) });
  });

  router.get("/api/orders/:id", (ctx) => {
    const user = requireUser(ctx, session);
    const order = repos.orders.findForOwner(ctx.params["id"] ?? "", user.id);
    if (!order) throw new NotFoundError("order", ctx.params["id"] ?? "");

    const quote = repos.quotes.findForOwner(order.quoteId, user.id);
    return json(200, {
      order: orderView(order),
      quote: quote ? quoteView(quote) : null,
      events: repos.orders.events(order.id),
      payments: repos.payments.listForOrder(order.id).map(paymentView),
    });
  });

  /* --- The customer dashboard --------------------------------------------- */

  router.get("/api/dashboard", (ctx) => {
    const user = requireUser(ctx, session);
    const projects = repos.projects.listForOwner(user.id);
    const quotes = repos.quotes.listForOwner(user.id);
    const orders = repos.orders.listForOwner(user.id);

    return json(200, {
      user: publicUser(user),
      projects: projects.map((project) => {
        const strategy = repos.strategies.findForProject(project.id);
        const identity = repos.identities.findForProject(project.id);
        const items = repos.packages.listForProject(project.id);
        return {
          id: project.id,
          name: strategy?.name ?? project.name,
          status: project.status,
          slogan: strategy?.slogan ?? null,
          palette: identity?.palette ?? null,
          packageItems: items.length,
          updatedAt: project.updatedAt,
          nextStep: nextStepFor(project.status, !!strategy, items.length),
        };
      }),
      quotes: quotes.map(quoteView),
      orders: orders.map(orderView),
      counts: { projects: projects.length, quotes: quotes.length, orders: orders.length },
    });
  });

  /* --- Admin --------------------------------------------------------------- */

  router.get("/api/admin/overview", (ctx) => {
    requireAdmin(ctx, session);
    const orders = repos.orders.listAsAdmin(500);
    const quotes = repos.quotes.listAsAdmin(500);
    const currency = deps.pricing.currency;

    const paid = orders.filter((o) => o.paymentStatus === "paid");
    const revenue = sum(
      paid.filter((o) => o.currency === currency).map((o) => o.total),
      currency,
    );

    return json(200, {
      counts: {
        customers: repos.users.listAsAdmin(1_000).length,
        projects: repos.projects.listAsAdmin(1_000).length,
        quotes: quotes.length,
        orders: orders.length,
        awaitingFulfilment: orders.filter(
          (o) => o.paymentStatus === "paid" && o.fulfillmentStatus !== "delivered",
        ).length,
      },
      revenue: asMoney(revenue),
      integrations: [
        aliexpressIntegrationStatus(deps.env ?? process.env),
        paystackIntegrationStatus(deps.env ?? process.env),
      ],
    });
  });

  router.get("/api/admin/customers", (ctx) => {
    requireAdmin(ctx, session);
    return json(200, {
      customers: repos.users.listAsAdmin(500).map((u) => ({
        ...publicUser(u),
        createdAt: u.createdAt,
        projects: repos.projects.listForOwner(u.id).length,
        orders: repos.orders.listForOwner(u.id).length,
      })),
    });
  });

  router.get("/api/admin/projects", (ctx) => {
    requireAdmin(ctx, session);
    return json(200, {
      projects: repos.projects.listAsAdmin(500).map((project) => {
        const strategy = repos.strategies.findForProject(project.id);
        const owner = repos.users.findById(project.userId);
        return {
          ...project,
          brandName: strategy?.name ?? null,
          positioning: strategy?.positioning ?? null,
          ownerEmail: owner?.email ?? null,
        };
      }),
    });
  });

  // The only surface where margin is returned, and it is behind requireAdmin.
  router.get("/api/admin/quotes", (ctx) => {
    requireAdmin(ctx, session);
    return json(200, {
      quotes: repos.quotes.listAsAdmin(500).map((quote) => ({
        ...quoteView(quote),
        margin: asMoney(quote.margin),
        ownerEmail: repos.users.findById(quote.userId)?.email ?? null,
      })),
    });
  });

  router.get("/api/admin/orders", (ctx) => {
    requireAdmin(ctx, session);
    return json(200, {
      orders: repos.orders.listAsAdmin(500).map((order) => ({
        ...orderView(order),
        ownerEmail: repos.users.findById(order.userId)?.email ?? null,
        payments: repos.payments.listForOrder(order.id).map(paymentView),
      })),
    });
  });

  router.patch("/api/admin/orders/:id", (ctx) => {
    const admin = requireAdmin(ctx, session);
    const order = repos.orders.findAsAdmin(ctx.params["id"] ?? "");
    if (!order) throw new NotFoundError("order", ctx.params["id"] ?? "");

    const fulfillment = optionalString(ctx.body, "fulfillmentStatus", 40);
    const payment = optionalString(ctx.body, "paymentStatus", 40);

    if (fulfillment) {
      if (!FULFILLMENT_STATUSES.includes(fulfillment)) {
        throw new ValidationError("fulfillmentStatus", `expected one of ${FULFILLMENT_STATUSES.join(", ")}`);
      }
      repos.orders.setFulfillmentStatus(order.id, fulfillment as never);
      repos.orders.addEvent(order.id, `fulfilment:${fulfillment}`, `admin:${admin.id}`);
    }

    if (payment) {
      if (!PAYMENT_STATUSES.includes(payment)) {
        throw new ValidationError("paymentStatus", `expected one of ${PAYMENT_STATUSES.join(", ")}`);
      }
      // §45: an admin marking a manual transfer received is a human decision,
      // recorded with their id. Nothing automatic ever reaches 'paid'.
      repos.orders.setPaymentStatus(order.id, payment as never);
      repos.orders.addEvent(order.id, `payment:${payment}`, `admin:${admin.id}`);
    }

    if (!fulfillment && !payment) {
      throw new ValidationError("status", "nothing to change");
    }

    return json(200, { order: orderView(repos.orders.findAsAdmin(order.id) ?? order) });
  });

  router.get("/api/admin/integrations", (ctx) => {
    requireAdmin(ctx, session);
    // Masks only. There is no variant of this route that returns a value.
    return json(200, {
      integrations: [
        aliexpressIntegrationStatus(deps.env ?? process.env),
        paystackIntegrationStatus(deps.env ?? process.env),
      ],
    });
  });

  /* --- Guard rails --------------------------------------------------------- */

  // Anything under /api that no route claimed is a 404 in JSON, not the static
  // fallback's index.html — an HTML body arriving where JSON was expected sends
  // whoever is debugging in entirely the wrong direction.
  router.get("/api/:rest", () => json(404, { error: "not-found", message: "No such endpoint." }));

  return router;
}

/* --- Shared shapes --------------------------------------------------------- */

const FULFILLMENT_STATUSES = [
  "pending",
  "confirmed",
  "sourcing",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
];

const PAYMENT_STATUSES = ["unpaid", "pending", "paid", "failed", "refunded"];

/** Never includes `margin` — the type it accepts may carry it; this does not. */
function quoteView(quote: {
  id: string;
  projectId: string;
  reference: string;
  currency: string;
  lineItems: { productId: string; description: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: { amount: number; currency: string };
  shipping: { amount: number; currency: string };
  fees: { amount: number; currency: string };
  total: { amount: number; currency: string };
  status: string;
  validUntil: string;
  createdAt: string;
}) {
  return {
    id: quote.id,
    projectId: quote.projectId,
    reference: quote.reference,
    currency: quote.currency,
    lines: quote.lineItems.map((line) => ({
      productId: line.productId,
      description: line.description,
      quantity: line.quantity,
      unitPrice: asMoney(money(line.unitPrice, quote.currency as never)),
      total: asMoney(money(line.total, quote.currency as never)),
    })),
    subtotal: asMoney(quote.subtotal),
    shipping: asMoney(quote.shipping),
    fees: asMoney(quote.fees),
    total: asMoney(quote.total),
    status: quote.status,
    validUntil: quote.validUntil,
    createdAt: quote.createdAt,
    // §38: shown as "unavailable" rather than filled with a plausible number.
    deliveryEstimate: null,
  };
}

function orderView(order: {
  id: string;
  projectId: string;
  quoteId: string;
  reference: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  total: { amount: number; currency: string };
  currency: string;
  trackingNumber?: string;
  carrier?: string;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: order.id,
    projectId: order.projectId,
    quoteId: order.quoteId,
    reference: order.reference,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    total: asMoney(order.total),
    currency: order.currency,
    trackingNumber: order.trackingNumber ?? null,
    carrier: order.carrier ?? null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

function paymentView(payment: {
  reference: string;
  provider: string;
  amount: { amount: number; currency: string };
  status: string;
  verifiedAt?: string;
  createdAt: string;
}) {
  return {
    reference: payment.reference,
    provider: payment.provider,
    amount: asMoney(payment.amount),
    status: payment.status,
    verifiedAt: payment.verifiedAt ?? null,
    createdAt: payment.createdAt,
  };
}

function identityView(profile: { palette: unknown; typography: unknown; logoBrief: string }) {
  return { palette: profile.palette, typography: profile.typography, logoBrief: profile.logoBrief };
}

/** Where "Resume" should land. One definition, so every surface agrees. */
function nextStepFor(status: string, hasStrategy: boolean, packageItems: number): string {
  if (!hasStrategy) return status === "draft" ? "interview" : "generate";
  if (packageItems === 0) return "products";
  return "quote";
}

/* --- Reading an interview off an untrusted body ---------------------------- */

function readAnswers(source: Record<string, unknown> | unknown): InterviewAnswer[] {
  const container = (source ?? {}) as Record<string, unknown>;
  const raw = requireArray(container, "answers", 40);

  return raw.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new ValidationError(`answers[${index}]`, "must be an object");
    }
    const record = entry as Record<string, unknown>;
    const field = record["field"];
    if (typeof field !== "string") throw new ValidationError(`answers[${index}].field`, "is required");

    const value = record["value"];
    if (Array.isArray(value)) {
      const values = value.filter((v): v is string => typeof v === "string").slice(0, 20);
      return { field: field as never, value: values, inferred: record["inferred"] === true };
    }
    if (typeof value !== "string") {
      throw new ValidationError(`answers[${index}].value`, "must be text or a list of text");
    }
    if (value.length > 2_000) {
      throw new ValidationError(`answers[${index}].value`, "must be at most 2000 characters");
    }
    return { field: field as never, value, inferred: record["inferred"] === true };
  });
}

/** Whether the answers satisfy the engine, without throwing on a partial save. */
function isComplete(answers: readonly InterviewAnswer[]): boolean {
  try {
    buildBrief(answers);
    return true;
  } catch {
    return false;
  }
}

/* --- References ------------------------------------------------------------ */

/**
 * Insert with a readable reference, retrying past a collision.
 *
 * The sequence is advisory; the UNIQUE index is authoritative. Two customers
 * checking out in the same millisecond both compute the same number, and the
 * loser retries rather than failing.
 */
function insertQuoteWithUniqueReference(
  repos: Repositories,
  at: Date,
  input: Omit<Parameters<Repositories["quotes"]["create"]>[0], "reference">,
) {
  const prefix = `BRA-${at.getUTCFullYear()}-`;
  let sequence = repos.quotes.nextSequence(prefix);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return repos.quotes.create({ ...input, reference: quoteReference(at, sequence) });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      sequence += 1;
    }
  }
  throw new ValidationError("reference", "could not allocate a quote reference");
}

function insertOrderWithUniqueReference(
  repos: Repositories,
  at: Date,
  input: Omit<Parameters<Repositories["orders"]["create"]>[0], "reference">,
) {
  const prefix = `ORD-${at.getUTCFullYear()}-`;
  let sequence = repos.orders.nextSequence(prefix);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return repos.orders.create({
        ...input,
        reference: `${prefix}${String(sequence).padStart(4, "0")}`,
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      sequence += 1;
    }
  }
  throw new ValidationError("reference", "could not allocate an order reference");
}

const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
