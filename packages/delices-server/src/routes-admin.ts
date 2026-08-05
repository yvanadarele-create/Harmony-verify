/**
 * The admin API.
 *
 * Everything under `/api/admin` requires a session. Mutations additionally require
 * the `X-Delices-Admin` header, which a cross-site form cannot set without a
 * preflight — combined with a `SameSite=Strict` cookie that is the CSRF story for
 * V1, and it costs one line per request.
 */
import type { AdminUser, AppointmentStatus, OrderStatus } from "@delices/core";
import { isOrderStatus, isPaymentStatus, todayIso } from "@delices/core";
import {
  addOrderItem,
  authenticate,
  calendar,
  countUsers,
  createCategory,
  createInventoryItem,
  createMedia,
  createOption,
  createProduct,
  createSession,
  createSupplier,
  createTestimonial,
  createUser,
  dashboardStats,
  deleteCategory,
  deleteInventoryItem,
  deleteMedia,
  deleteOption,
  deleteProduct,
  deleteSupplier,
  deleteTestimonial,
  destroySession,
  getAllSettings,
  getCustomerSummary,
  getOrder,
  listAppointments,
  listCategories,
  listCustomers,
  listGlobalOptions,
  listInventory,
  listMedia,
  listNotifications,
  listOrders,
  listProductOptions,
  listProducts,
  listSuppliers,
  listTestimonials,
  listUsers,
  markAllNotificationsRead,
  removeOrderItem,
  setPassword,
  setProductMedia,
  setSettings,
  updateAppointment,
  updateCategory,
  updateCustomer,
  updateInventoryItem,
  updateMediaAlt,
  updateOption,
  updateOrder,
  updateOrderStatus,
  updateProduct,
  updateSupplier,
  updateTestimonial,
  userForSession,
} from "@delices/db";
import type { InventoryInput, ProductInput } from "@delices/db";
import { SESSION_COOKIE, type AppContext } from "./context.js";
import {
  badRequest,
  clearCookie,
  conflict,
  notFound,
  ok,
  parseCookies,
  query,
  queryBool,
  readJson,
  sendJson,
  setCookie,
  tooMany,
  unauthorized,
  type RequestContext,
} from "./http.js";
import { route, type Handler, type Route } from "./router.js";
import { readUpload, storeUpload } from "./uploads.js";

function currentUser(app: AppContext, ctx: RequestContext): AdminUser | null {
  const token = parseCookies(ctx.req.headers.cookie)[SESSION_COOKIE];
  return token ? userForSession(app.db, token) : null;
}

/** Wraps a handler so it only runs for a signed-in user. */
function guard(app: AppContext, handler: (ctx: RequestContext, user: AdminUser) => unknown): Handler {
  return async (ctx) => {
    const user = currentUser(app, ctx);
    if (!user) return unauthorized(ctx.res);
    const method = ctx.req.method ?? "GET";
    if (method !== "GET" && ctx.req.headers["x-delices-admin"] === undefined) {
      return sendJson(ctx.res, 403, { error: "Requête refusée." });
    }
    await handler(ctx, user);
  };
}

const asString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const asNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const asBool = (value: unknown): boolean => value === true || value === "true" || value === 1;

export function adminRoutes(app: AppContext): Route[] {
  const g = (handler: (ctx: RequestContext, user: AdminUser) => unknown): Handler =>
    guard(app, handler);

  return [
    // ---------------------------------------------------------------- session

    route("POST", "/api/admin/login", async ({ req, res, ip }) => {
      if (!app.limits.login.take(ip)) return tooMany(res);
      const input = (await readJson(req)) as { email?: string; password?: string };
      const email = asString(input?.email);
      const password = typeof input?.password === "string" ? input.password : "";
      const user = email && password ? authenticate(app.db, email, password) : null;
      if (!user) {
        return sendJson(res, 401, { error: "Identifiants incorrects." });
      }
      const session = createSession(app.db, user.id);
      setCookie(res, SESSION_COOKIE, session.token, {
        maxAge: 12 * 3600,
        secure: app.secureCookies,
      });
      app.limits.login.reset(ip);
      ok(res, { user });
    }),

    route("POST", "/api/admin/logout", ({ req, res }) => {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (token) destroySession(app.db, token);
      clearCookie(res, SESSION_COOKIE, app.secureCookies);
      ok(res, { ok: true });
    }),

    route("GET", "/api/admin/me", (ctx) => {
      const user = currentUser(app, ctx);
      if (!user) return unauthorized(ctx.res);
      ok(ctx.res, { user });
    }),

    // ---------------------------------------------------------------- dashboard

    route(
      "GET",
      "/api/admin/dashboard",
      g((ctx) => {
        const today = todayIso();
        const stats = dashboardStats(app.db, today);
        const settings = getAllSettings(app.db);
        ok(ctx.res, {
          stats,
          today,
          currency: settings.currency,
          locale: settings.locale,
          todayOrders: listOrders(app.db, { from: today, to: today }),
          attention: listOrders(app.db, { statuses: ["NEW", "REVIEWING"], limit: 20 }),
          upcoming: listOrders(app.db, {
            from: today,
            statuses: ["CONFIRMED", "DEPOSIT_PAID", "IN_PRODUCTION", "READY", "OUT_FOR_DELIVERY"],
            limit: 20,
          }),
          lowStock: listInventory(app.db, { lowOnly: true }),
        });
      }),
    ),

    route(
      "GET",
      "/api/admin/calendar",
      g((ctx) => {
        const today = todayIso();
        const from = query(ctx.url, "from") ?? today;
        const to = query(ctx.url, "to") ?? addDays(today, 60);
        ok(ctx.res, { from, to, days: calendar(app.db, from, to), orders: listOrders(app.db, { from, to }) });
      }),
    ),

    // ---------------------------------------------------------------- orders

    route(
      "GET",
      "/api/admin/orders",
      g((ctx) => {
        const statusParam = query(ctx.url, "status");
        const statuses = statusParam
          ? (statusParam.split(",").filter(isOrderStatus) as OrderStatus[])
          : undefined;
        const kind = query(ctx.url, "kind");
        ok(
          ctx.res,
          listOrders(app.db, {
            ...(statuses && statuses.length > 0 ? { statuses } : {}),
            ...(kind === "standard" || kind === "custom" ? { kind } : {}),
            ...(query(ctx.url, "from") ? { from: query(ctx.url, "from")! } : {}),
            ...(query(ctx.url, "to") ? { to: query(ctx.url, "to")! } : {}),
            ...(query(ctx.url, "search") ? { search: query(ctx.url, "search")! } : {}),
          }),
        );
      }),
    ),

    route(
      "GET",
      "/api/admin/orders/:id",
      g((ctx) => {
        const order = getOrder(app.db, ctx.params.id!);
        if (!order) return notFound(ctx.res, "Commande introuvable.");
        ok(ctx.res, order);
      }),
    ),

    route(
      "PATCH",
      "/api/admin/orders/:id",
      g(async (ctx) => {
        const input = (await readJson(ctx.req)) as Record<string, unknown>;
        const patch: Parameters<typeof updateOrder>[2] = {};
        if (input.requestedDate !== undefined) patch.requestedDate = asString(input.requestedDate);
        if (input.fulfillment === "pickup" || input.fulfillment === "delivery") {
          patch.fulfillment = input.fulfillment;
        }
        if (input.address !== undefined) patch.address = asString(input.address);
        if (input.deliveryNotes !== undefined) patch.deliveryNotes = asString(input.deliveryNotes);
        if (input.internalNotes !== undefined) patch.internalNotes = asString(input.internalNotes);
        if (input.quotedTotal !== undefined) patch.quotedTotal = asNumberOrNull(input.quotedTotal);
        if (input.depositPaid !== undefined) patch.depositPaid = asNumberOrNull(input.depositPaid) ?? 0;
        if (input.paymentStatus !== undefined) {
          if (!isPaymentStatus(input.paymentStatus)) {
            return badRequest(ctx.res, [{ field: "paymentStatus", message: "Statut de paiement inconnu." }]);
          }
          patch.paymentStatus = input.paymentStatus;
        }
        const order = updateOrder(app.db, ctx.params.id!, patch);
        if (!order) return notFound(ctx.res, "Commande introuvable.");
        ok(ctx.res, order);
      }),
    ),

    route(
      "POST",
      "/api/admin/orders/:id/status",
      g(async (ctx) => {
        const input = (await readJson(ctx.req)) as { status?: unknown; note?: unknown };
        if (!isOrderStatus(input?.status)) {
          return badRequest(ctx.res, [{ field: "status", message: "Statut inconnu." }]);
        }
        const result = updateOrderStatus(app.db, ctx.params.id!, input.status, asString(input.note));
        if (!result.ok) return conflict(ctx.res, result.reason);
        ok(ctx.res, result.order);
      }),
    ),

    route(
      "POST",
      "/api/admin/orders/:id/items",
      g(async (ctx) => {
        const input = (await readJson(ctx.req)) as Record<string, unknown>;
        const name = asString(input.productName);
        const quantity = Number(input.quantity ?? 1);
        if (name === "" || !Number.isInteger(quantity) || quantity < 1) {
          return badRequest(ctx.res, [{ field: "productName", message: "Ligne invalide." }]);
        }
        const order = addOrderItem(app.db, ctx.params.id!, {
          productName: name,
          categoryName: asString(input.categoryName),
          unitPrice: asNumberOrNull(input.unitPrice),
          quantity,
          notes: asString(input.notes),
        });
        if (!order) return notFound(ctx.res, "Commande introuvable.");
        ok(ctx.res, order);
      }),
    ),

    route(
      "DELETE",
      "/api/admin/orders/:id/items/:itemId",
      g((ctx) => {
        const order = removeOrderItem(app.db, ctx.params.id!, ctx.params.itemId!);
        if (!order) return notFound(ctx.res, "Commande introuvable.");
        ok(ctx.res, order);
      }),
    ),

    // ---------------------------------------------------------------- customers

    route(
      "GET",
      "/api/admin/customers",
      g((ctx) => ok(ctx.res, listCustomers(app.db, query(ctx.url, "search")))),
    ),

    route(
      "GET",
      "/api/admin/customers/:id",
      g((ctx) => {
        const customer = getCustomerSummary(app.db, ctx.params.id!);
        if (!customer) return notFound(ctx.res, "Client introuvable.");
        ok(ctx.res, { customer, orders: listOrders(app.db, { customerId: customer.id }) });
      }),
    ),

    route(
      "PATCH",
      "/api/admin/customers/:id",
      g(async (ctx) => {
        const input = (await readJson(ctx.req)) as Record<string, unknown>;
        const customer = updateCustomer(app.db, ctx.params.id!, {
          ...(input.name !== undefined ? { name: asString(input.name) } : {}),
          ...(input.phone !== undefined ? { phone: asString(input.phone) } : {}),
          ...(input.whatsapp !== undefined ? { whatsapp: asString(input.whatsapp) } : {}),
          ...(input.email !== undefined ? { email: asString(input.email) } : {}),
          ...(input.address !== undefined ? { address: asString(input.address) } : {}),
          ...(input.preferences !== undefined ? { preferences: asString(input.preferences) } : {}),
          ...(input.notes !== undefined ? { notes: asString(input.notes) } : {}),
        });
        if (!customer) return notFound(ctx.res, "Client introuvable.");
        ok(ctx.res, customer);
      }),
    ),

    // ---------------------------------------------------------------- catalogue

    route(
      "GET",
      "/api/admin/categories",
      g((ctx) => ok(ctx.res, listCategories(app.db))),
    ),

    route(
      "POST",
      "/api/admin/categories",
      g(async (ctx) => {
        const input = (await readJson(ctx.req)) as Record<string, unknown>;
        const name = asString(input.name);
        if (name === "") return badRequest(ctx.res, [{ field: "name", message: "Nom requis." }]);
        ok(
          ctx.res,
          createCategory(app.db, {
            name,
            ...(asString(input.slug) ? { slug: asString(input.slug) } : {}),
            description: asString(input.description),
            kind:
              input.kind === "custom" || input.kind === "both" ? input.kind : "standard",
            sortOrder: asNumberOrNull(input.sortOrder) ?? 0,
            active: input.active === undefined ? true : asBool(input.active),
          }),
        );
      }),
    ),

    route(
      "PATCH",
      "/api/admin/categories/:id",
      g(async (ctx) => {
        const input = (await readJson(ctx.req)) as Record<string, unknown>;
        const category = updateCategory(app.db, ctx.params.id!, {
          ...(input.name !== undefined ? { name: asString(input.name) } : {}),
          ...(input.description !== undefined ? { description: asString(input.description) } : {}),
          ...(input.kind === "standard" || input.kind === "custom" || input.kind === "both"
            ? { kind: input.kind }
            : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: asNumberOrNull(input.sortOrder) ?? 0 } : {}),
          ...(input.active !== undefined ? { active: asBool(input.active) } : {}),
        });
        if (!category) return notFound(ctx.res, "Catégorie introuvable.");
        ok(ctx.res, category);
      }),
    ),

    route(
      "DELETE",
      "/api/admin/categories/:id",
      g((ctx) => {
        const result = deleteCategory(app.db, ctx.params.id!);
        if (!result.ok) return conflict(ctx.res, result.reason!);
        ok(ctx.res, { ok: true });
      }),
    ),

    route(
      "GET",
      "/api/admin/products",
      g((ctx) =>
        ok(
          ctx.res,
          listProducts(app.db, {
            ...(query(ctx.url, "category") ? { categorySlug: query(ctx.url, "category")! } : {}),
            ...(query(ctx.url, "search") ? { search: query(ctx.url, "search")! } : {}),
          }),
        ),
      ),
    ),

    route(
      "POST",
      "/api/admin/products",
      g(async (ctx) => {
        const input = (await readJson(ctx.req)) as Record<string, unknown>;
        const name = asString(input.name);
        const categoryId = asString(input.categoryId);
        if (name === "" || categoryId === "") {
          return badRequest(ctx.res, [
            { field: "name", message: "Nom et catégorie sont obligatoires." },
          ]);
        }
        ok(ctx.res, createProduct(app.db, { ...productInput(input), name, categoryId }));
      }),
    ),

    route(
      "PATCH",
      "/api/admin/products/:id",
      g(async (ctx) => {
        const input = (await readJson(ctx.req)) as Record<string, unknown>;
        const product = updateProduct(app.db, ctx.params.id!, productInput(input));
        if (!product) return notFound(ctx.res, "Produit introuvable.");
        ok(ctx.res, product);
      }),
    ),

    route(
      "DELETE",
      "/api/admin/products/:id",
      g((ctx) => {
        deleteProduct(app.db, ctx.params.id!);
        ok(ctx.res, { ok: true });
      }),
    ),

    route(
      "PUT",
      "/api/admin/products/:id/media",
      g(async (ctx) => {
        const input = (await readJson(ctx.req)) as { mediaIds?: unknown };
        const mediaIds = Array.isArray(input?.mediaIds) ? input.mediaIds.map(String) : [];
        setProductMedia(app.db, ctx.params.id!, mediaIds);
        ok(ctx.res, { ok: true });
      }),
    ),

    // ---------------------------------------------------------------- options

    route(
      "GET",
      "/api/admin/options",
      g((ctx) => {
        const productId = query(ctx.url, "productId");
        ok(
          ctx.res,
          productId ? listProductOptions(app.db, productId) : listGlobalOptions(app.db),
        );
      }),
    ),

    route(
      "POST",
      "/api/admin/options",
      g(async (ctx) => {
        const input = (await readJson(ctx.req)) as Record<string, unknown>;
        const kind = asString(input.kind);
        const label = asString(input.label);
        const validKinds = ["size", "flavour", "filling", "decoration", "shape", "occasion", "extra"];
        if (!validKinds.includes(kind) || label === "") {
          return badRequest(ctx.res, [{ field: "label", message: "Option invalide." }]);
        }
        ok(
          ctx.res,
          createOption(app.db, {
            productId: asString(input.productId) || null,
            kind: kind as "size",
            groupLabel: asString(input.groupLabel) || label,
            label,
            priceDelta: asNumberOrNull(input.priceDelta) ?? 0,
            servings: asNumberOrNull(input.servings),
            required: asBool(input.required),
            multiple: asBool(input.multiple),
            sortOrder: asNumberOrNull(input.sortOrder) ?? 0,
            active: input.active === undefined ? true : asBool(input.active),
          }),
        );
      }),
    ),

    route(
      "PATCH",
      "/api/admin/options/:id",
      g(async (ctx) => {
        const input = (await readJson(ctx.req)) as Record<string, unknown>;
        const option = updateOption(app.db, ctx.params.id!, {
          ...(input.label !== undefined ? { label: asString(input.label) } : {}),
          ...(input.groupLabel !== undefined ? { groupLabel: asString(input.groupLabel) } : {}),
          ...(input.priceDelta !== undefined ? { priceDelta: asNumberOrNull(input.priceDelta) ?? 0 } : {}),
          ...(input.servings !== undefined ? { servings: asNumberOrNull(input.servings) } : {}),
          ...(input.required !== undefined ? { required: asBool(input.required) } : {}),
          ...(input.multiple !== undefined ? { multiple: asBool(input.multiple) } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: asNumberOrNull(input.sortOrder) ?? 0 } : {}),
          ...(input.active !== undefined ? { active: asBool(input.active) } : {}),
        });
        if (!option) return notFound(ctx.res, "Option introuvable.");
        ok(ctx.res, option);
      }),
    ),

    route(
      "DELETE",
      "/api/admin/options/:id",
      g((ctx) => {
        deleteOption(app.db, ctx.params.id!);
        ok(ctx.res, { ok: true });
      }),
    ),

    // ---------------------------------------------------------------- media

    route(
      "GET",
      "/api/admin/media",
      g((ctx) =>
        ok(ctx.res, listMedia(app.db, queryBool(ctx.url, "inspiration") ? "inspiration" : "gallery")),
      ),
    ),

    route(
      "POST",
      "/api/admin/media",
      g(async (ctx) => {
        const result = await readUpload(ctx.req);
        if (!result.ok) return sendJson(ctx.res, result.status, { error: result.message });
        const url = await storeUpload(app.uploadDir, result.file);
        ok(
          ctx.res,
          createMedia(app.db, {
            filename: result.file.filename,
            url,
            mimeType: result.file.mimeType,
            byteSize: result.file.bytes.length,
            source: "gallery",
          }),
        );
      }),
    ),

    route(
      "PATCH",
      "/api/admin/media/:id",
      g(async (ctx) => {
        const input = (await readJson(ctx.req)) as { alt?: unknown };
        const asset = updateMediaAlt(app.db, ctx.params.id!, asString(input?.alt));
        if (!asset) return notFound(ctx.res, "Image introuvable.");
        ok(ctx.res, asset);
      }),
    ),

    route(
      "DELETE",
      "/api/admin/media/:id",
      g((ctx) => {
        deleteMedia(app.db, ctx.params.id!);
        ok(ctx.res, { ok: true });
      }),
    ),

    // ---------------------------------------------------------------- appointments

    route(
      "GET",
      "/api/admin/appointments",
      g((ctx) => {
        const status = query(ctx.url, "status");
        ok(ctx.res, listAppointments(app.db, status as AppointmentStatus | undefined));
      }),
    ),

    route(
      "PATCH",
      "/api/admin/appointments/:id",
      g(async (ctx) => {
        const input = (await readJson(ctx.req)) as Record<string, unknown>;
        const appointment = updateAppointment(app.db, ctx.params.id!, {
          ...(typeof input.status === "string" ? { status: input.status as AppointmentStatus } : {}),
          ...(input.internalNotes !== undefined ? { internalNotes: asString(input.internalNotes) } : {}),
          ...(input.preferredDate !== undefined ? { preferredDate: asString(input.preferredDate) } : {}),
          ...(input.preferredTime !== undefined ? { preferredTime: asString(input.preferredTime) } : {}),
        });
        if (!appointment) return notFound(ctx.res, "Rendez-vous introuvable.");
        ok(ctx.res, appointment);
      }),
    ),

    // ---------------------------------------------------------------- inventory

    route(
      "GET",
      "/api/admin/inventory",
      g((ctx) => ok(ctx.res, listInventory(app.db, { lowOnly: queryBool(ctx.url, "low") }))),
    ),

    route(
      "POST",
      "/api/admin/inventory",
      g(async (ctx) => {
        const input = (await readJson(ctx.req)) as Record<string, unknown>;
        const name = asString(input.name);
        if (name === "") return badRequest(ctx.res, [{ field: "name", message: "Nom requis." }]);
        ok(ctx.res, createInventoryItem(app.db, { ...inventoryInput(input), name }));
      }),
    ),

    route(
      "PATCH",
      "/api/admin/inventory/:id",
      g(async (ctx) => {
        const input = (await readJson(ctx.req)) as Record<string, unknown>;
        const item = updateInventoryItem(app.db, ctx.params.id!, inventoryInput(input));
        if (!item) return notFound(ctx.res, "Article introuvable.");
        ok(ctx.res, item);
      }),
    ),

    route(
      "DELETE",
      "/api/admin/inventory/:id",
      g((ctx) => {
        deleteInventoryItem(app.db, ctx.params.id!);
        ok(ctx.res, { ok: true });
      }),
    ),

    route(
      "GET",
      "/api/admin/suppliers",
      g((ctx) => ok(ctx.res, listSuppliers(app.db))),
    ),

    route(
      "POST",
      "/api/admin/suppliers",
      g(async (ctx) => {
        const input = (await readJson(ctx.req)) as Record<string, unknown>;
        const name = asString(input.name);
        if (name === "") return badRequest(ctx.res, [{ field: "name", message: "Nom requis." }]);
        ok(
          ctx.res,
          createSupplier(app.db, {
            name,
            phone: asString(input.phone),
            email: asString(input.email),
            notes: asString(input.notes),
          }),
        );
      }),
    ),

    route(
      "PATCH",
      "/api/admin/suppliers/:id",
      g(async (ctx) => {
        const input = (await readJson(ctx.req)) as Record<string, unknown>;
        const supplier = updateSupplier(app.db, ctx.params.id!, {
          ...(input.name !== undefined ? { name: asString(input.name) } : {}),
          ...(input.phone !== undefined ? { phone: asString(input.phone) } : {}),
          ...(input.email !== undefined ? { email: asString(input.email) } : {}),
          ...(input.notes !== undefined ? { notes: asString(input.notes) } : {}),
        });
        if (!supplier) return notFound(ctx.res, "Fournisseur introuvable.");
        ok(ctx.res, supplier);
      }),
    ),

    route(
      "DELETE",
      "/api/admin/suppliers/:id",
      g((ctx) => {
        deleteSupplier(app.db, ctx.params.id!);
        ok(ctx.res, { ok: true });
      }),
    ),

    // ---------------------------------------------------------------- testimonials

    route(
      "GET",
      "/api/admin/testimonials",
      g((ctx) => ok(ctx.res, listTestimonials(app.db))),
    ),

    route(
      "POST",
      "/api/admin/testimonials",
      g(async (ctx) => {
        const input = (await readJson(ctx.req)) as Record<string, unknown>;
        const customerName = asString(input.customerName);
        const bodyText = asString(input.body);
        if (customerName === "" || bodyText === "") {
          return badRequest(ctx.res, [
            { field: "body", message: "Nom et témoignage sont obligatoires." },
          ]);
        }
        ok(
          ctx.res,
          createTestimonial(app.db, {
            customerName,
            body: bodyText,
            photoMediaId: asString(input.photoMediaId) || null,
            productId: asString(input.productId) || null,
            eventDate: asString(input.eventDate) || null,
            published: asBool(input.published),
            sortOrder: asNumberOrNull(input.sortOrder) ?? 0,
          }),
        );
      }),
    ),

    route(
      "PATCH",
      "/api/admin/testimonials/:id",
      g(async (ctx) => {
        const input = (await readJson(ctx.req)) as Record<string, unknown>;
        const testimonial = updateTestimonial(app.db, ctx.params.id!, {
          ...(input.customerName !== undefined ? { customerName: asString(input.customerName) } : {}),
          ...(input.body !== undefined ? { body: asString(input.body) } : {}),
          ...(input.photoMediaId !== undefined ? { photoMediaId: asString(input.photoMediaId) || null } : {}),
          ...(input.productId !== undefined ? { productId: asString(input.productId) || null } : {}),
          ...(input.eventDate !== undefined ? { eventDate: asString(input.eventDate) || null } : {}),
          ...(input.published !== undefined ? { published: asBool(input.published) } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: asNumberOrNull(input.sortOrder) ?? 0 } : {}),
        });
        if (!testimonial) return notFound(ctx.res, "Témoignage introuvable.");
        ok(ctx.res, testimonial);
      }),
    ),

    route(
      "DELETE",
      "/api/admin/testimonials/:id",
      g((ctx) => {
        deleteTestimonial(app.db, ctx.params.id!);
        ok(ctx.res, { ok: true });
      }),
    ),

    // ---------------------------------------------------------------- settings

    route(
      "GET",
      "/api/admin/settings",
      g((ctx) => ok(ctx.res, getAllSettings(app.db))),
    ),

    route(
      "PUT",
      "/api/admin/settings",
      g(async (ctx) => {
        const input = (await readJson(ctx.req)) as Record<string, unknown>;
        const values: Record<string, string> = {};
        for (const [key, value] of Object.entries(input ?? {})) {
          if (/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(key)) values[key] = String(value ?? "");
        }
        setSettings(app.db, values);
        ok(ctx.res, getAllSettings(app.db));
      }),
    ),

    // ---------------------------------------------------------------- notifications

    route(
      "GET",
      "/api/admin/notifications",
      g((ctx) => ok(ctx.res, listNotifications(app.db, { audience: "owner" }))),
    ),

    route(
      "POST",
      "/api/admin/notifications/read",
      g((ctx) => {
        markAllNotificationsRead(app.db);
        ok(ctx.res, { ok: true });
      }),
    ),

    // ---------------------------------------------------------------- staff

    route(
      "GET",
      "/api/admin/users",
      g((ctx) => ok(ctx.res, listUsers(app.db))),
    ),

    route(
      "POST",
      "/api/admin/users",
      g(async (ctx, user) => {
        if (user.role !== "owner") return sendJson(ctx.res, 403, { error: "Réservé au compte propriétaire." });
        const input = (await readJson(ctx.req)) as Record<string, unknown>;
        const email = asString(input.email);
        const password = typeof input.password === "string" ? input.password : "";
        const name = asString(input.name);
        if (email === "" || name === "" || password.length < 10) {
          return badRequest(ctx.res, [
            { field: "password", message: "Nom, e-mail et mot de passe (10 caractères minimum) requis." },
          ]);
        }
        if (countUsers(app.db) >= 10) return conflict(ctx.res, "Trop de comptes.");
        ok(ctx.res, createUser(app.db, { name, email, password, role: "staff" }));
      }),
    ),

    route(
      "POST",
      "/api/admin/password",
      g(async (ctx, user) => {
        const input = (await readJson(ctx.req)) as Record<string, unknown>;
        const current = typeof input.currentPassword === "string" ? input.currentPassword : "";
        const next = typeof input.newPassword === "string" ? input.newPassword : "";
        if (next.length < 10) {
          return badRequest(ctx.res, [
            { field: "newPassword", message: "Le mot de passe doit faire au moins 10 caractères." },
          ]);
        }
        if (!authenticate(app.db, user.email, current)) {
          return badRequest(ctx.res, [
            { field: "currentPassword", message: "Mot de passe actuel incorrect." },
          ]);
        }
        setPassword(app.db, user.id, next);
        clearCookie(ctx.res, SESSION_COOKIE, app.secureCookies);
        ok(ctx.res, { ok: true, message: "Mot de passe modifié. Merci de vous reconnecter." });
      }),
    ),
  ];
}

function productInput(input: Record<string, unknown>): Partial<ProductInput> {
  const out: Partial<ProductInput> = {};
  if (input.categoryId !== undefined) out.categoryId = asString(input.categoryId);
  if (input.name !== undefined) out.name = asString(input.name);
  if (input.description !== undefined) out.description = asString(input.description);
  if (input.ingredients !== undefined) out.ingredients = asString(input.ingredients);
  if (input.basePrice !== undefined) out.basePrice = asNumberOrNull(input.basePrice);
  if (input.priceFrom !== undefined) out.priceFrom = asBool(input.priceFrom);
  if (input.servings !== undefined) out.servings = asNumberOrNull(input.servings);
  if (input.customisable !== undefined) out.customisable = asBool(input.customisable);
  if (input.available !== undefined) out.available = asBool(input.available);
  if (input.featured !== undefined) out.featured = asBool(input.featured);
  if (input.active !== undefined) out.active = asBool(input.active);
  if (input.sortOrder !== undefined) out.sortOrder = asNumberOrNull(input.sortOrder) ?? 0;
  return out;
}

function inventoryInput(input: Record<string, unknown>): Partial<InventoryInput> {
  const out: Partial<InventoryInput> = {};
  if (input.name !== undefined) out.name = asString(input.name);
  if (input.category !== undefined) out.category = asString(input.category);
  if (input.quantity !== undefined) out.quantity = asNumberOrNull(input.quantity) ?? 0;
  if (input.unit !== undefined) out.unit = asString(input.unit) || "unité";
  if (input.minimumStock !== undefined) out.minimumStock = asNumberOrNull(input.minimumStock) ?? 0;
  if (input.purchasePrice !== undefined) out.purchasePrice = asNumberOrNull(input.purchasePrice);
  if (input.supplierId !== undefined) out.supplierId = asString(input.supplierId) || null;
  return out;
}

function addDays(date: string, days: number): string {
  const base = new Date(`${date}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}
