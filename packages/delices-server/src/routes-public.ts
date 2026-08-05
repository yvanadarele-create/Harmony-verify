/**
 * The public API — everything the site itself calls.
 *
 * Two rules hold throughout: the browser never sends a price (amounts are resolved
 * from the catalogue server-side), and no response carries an internal note, a
 * customer's private details or anything beyond what the page needs to render.
 */
import type { CustomRequestDraft, Order, OrderDraft, Product } from "@delices/core";
import {
  customerFacingStatus,
  todayIso,
  validateAppointment,
  validateCustomRequest,
  validateOrderDraft,
} from "@delices/core";
import {
  createAppointment,
  createCustomOrder,
  createMedia,
  createStandardOrder,
  findOrderForTracking,
  getProductBySlug,
  getPublicSettings,
  getSetting,
  listCategories,
  listGlobalOptions,
  listMedia,
  listProducts,
  listTestimonials,
} from "@delices/db";
import type { AppContext } from "./context.js";
import {
  BadJson,
  PayloadTooLarge,
  badRequest,
  notFound,
  ok,
  query,
  readJson,
  sendJson,
  tooMany,
} from "./http.js";
import { appointmentAlert, customerAcknowledgement, deliver, ownerAlert } from "./notify.js";
import { route, type Route } from "./router.js";
import { MAX_UPLOAD_BYTES, readUpload, storeUpload } from "./uploads.js";

/** Strips a product to what a page renders — no timestamps, no inactive options. */
function publicProduct(product: Product): unknown {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    ingredients: product.ingredients,
    category: product.categorySlug,
    basePrice: product.basePrice,
    priceFrom: product.priceFrom,
    servings: product.servings,
    customisable: product.customisable,
    available: product.available,
    featured: product.featured,
    images: (product.media ?? []).map((asset) => ({ url: asset.url, alt: asset.alt })),
    options: (product.options ?? [])
      .filter((option) => option.active)
      .map((option) => ({
        id: option.id,
        kind: option.kind,
        group: option.groupLabel,
        label: option.label,
        priceDelta: option.priceDelta,
        servings: option.servings,
        required: option.required,
        multiple: option.multiple,
      })),
  };
}

function publicOrder(order: Order): unknown {
  return {
    reference: order.reference,
    status: order.status,
    statusLabel: customerFacingStatus(order.status),
    kind: order.kind,
    requestedDate: order.requestedDate,
    fulfillment: order.fulfillment,
    total: order.quotedTotal ?? (order.itemsTotal > 0 ? order.itemsTotal : null),
    quoted: order.quotedTotal !== null,
    paymentStatus: order.paymentStatus,
    items: (order.items ?? []).map((item) => ({
      name: item.productName,
      quantity: item.quantity,
      options: item.selectedOptions.map((option) => option.label),
    })),
    updatedAt: order.updatedAt,
  };
}

async function body(ctx: { req: Parameters<typeof readJson>[0] }): Promise<unknown> {
  return readJson(ctx.req);
}

export function publicRoutes(app: AppContext): Route[] {
  const settings = () => getPublicSettings(app.db);

  return [
    route("GET", "/api/health", ({ res }) => ok(res, { ok: true })),

    route("GET", "/api/settings", ({ res }) => ok(res, settings())),

    route("GET", "/api/categories", ({ res }) =>
      ok(
        res,
        listCategories(app.db, { activeOnly: true }).map((category) => ({
          slug: category.slug,
          name: category.name,
          description: category.description,
          kind: category.kind,
        })),
      ),
    ),

    route("GET", "/api/products", ({ res, url }) => {
      const products = listProducts(app.db, {
        activeOnly: true,
        ...(query(url, "category") ? { categorySlug: query(url, "category")! } : {}),
        ...(query(url, "featured") ? { featuredOnly: true } : {}),
      });
      ok(res, products.map(publicProduct));
    }),

    route("GET", "/api/products/:slug", ({ res, params }) => {
      const product = getProductBySlug(app.db, params.slug!);
      if (!product || !product.active) return notFound(res, "Produit introuvable.");
      ok(res, publicProduct(product));
    }),

    // The choice lists behind the custom-cake brief, grouped by kind.
    route("GET", "/api/options", ({ res }) => {
      const options = listGlobalOptions(app.db, { activeOnly: true });
      const grouped: Record<string, Array<{ id: string; label: string }>> = {};
      for (const option of options) {
        (grouped[option.kind] ??= []).push({ id: option.id, label: option.label });
      }
      ok(res, grouped);
    }),

    route("GET", "/api/testimonials", ({ res }) =>
      ok(
        res,
        listTestimonials(app.db, { publishedOnly: true }).map((testimonial) => ({
          customerName: testimonial.customerName,
          body: testimonial.body,
          photoUrl: testimonial.photoUrl,
          productName: testimonial.productName,
          eventDate: testimonial.eventDate,
        })),
      ),
    ),

    route("GET", "/api/gallery", ({ res }) =>
      ok(
        res,
        listMedia(app.db, "gallery").map((asset) => ({ url: asset.url, alt: asset.alt })),
      ),
    ),

    // ---------------------------------------------------------------- submissions

    route("POST", "/api/orders", async (ctx) => {
      if (!app.limits.submit.take(ctx.ip)) return tooMany(ctx.res);
      const draft = (await body(ctx)) as OrderDraft;
      const check = validateOrderDraft(draft, todayIso());
      if (!check.ok) return badRequest(ctx.res, check.errors);

      const result = createStandardOrder(app.db, draft);
      if (!result.ok) return badRequest(ctx.res, result.errors);
      await announce(app, result.order);
      sendJson(ctx.res, 201, {
        reference: result.order.reference,
        message:
          "Merci pour votre demande. Nous avons bien reçu votre commande et nous reviendrons vers vous pour confirmer les détails.",
      });
    }),

    route("POST", "/api/custom-requests", async (ctx) => {
      if (!app.limits.submit.take(ctx.ip)) return tooMany(ctx.res);
      const draft = (await body(ctx)) as CustomRequestDraft;
      const check = validateCustomRequest(draft, todayIso());
      if (!check.ok) return badRequest(ctx.res, check.errors);

      const result = createCustomOrder(app.db, draft);
      if (!result.ok) return badRequest(ctx.res, result.errors);
      await announce(app, result.order);
      sendJson(ctx.res, 201, {
        reference: result.order.reference,
        message:
          "Merci pour votre demande. Nous avons bien reçu votre commande et nous reviendrons vers vous pour confirmer les détails.",
      });
    }),

    route("POST", "/api/appointments", async (ctx) => {
      if (!app.limits.submit.take(ctx.ip)) return tooMany(ctx.res);
      const draft = (await body(ctx)) as Parameters<typeof createAppointment>[1];
      const check = validateAppointment(draft, todayIso());
      if (!check.ok) return badRequest(ctx.res, check.errors);

      const appointment = createAppointment(app.db, draft);
      const config = settings();
      await deliver(app.db, app.transport, {
        audience: "owner",
        recipient: ownerRecipient(app),
        message: appointmentAlert(appointment),
      });
      if (appointment.email) {
        await deliver(app.db, app.transport, {
          audience: "customer",
          recipient: appointment.email,
          message: {
            subject: `Votre demande de rendez-vous — ${config.businessName}`,
            body:
              `Bonjour ${appointment.name},\n\n` +
              "Merci pour votre demande. Nous avons bien reçu votre message et nous reviendrons " +
              "vers vous pour convenir d'un moment.\n\n" +
              `${config.businessName}`,
          },
        });
      }
      sendJson(ctx.res, 201, {
        message:
          "Merci. Nous avons bien reçu votre demande de rendez-vous et nous vous recontactons très vite.",
      });
    }),

    // Inspiration photo for a brief. Stored as `inspiration` so it never appears in
    // the public gallery, and returned as an id the form submits with the request.
    route("POST", "/api/uploads", async (ctx) => {
      if (!app.limits.upload.take(ctx.ip)) return tooMany(ctx.res);
      const result = await readUpload(ctx.req);
      if (!result.ok) return sendJson(ctx.res, result.status, { error: result.message });
      const url = await storeUpload(app.uploadDir, result.file);
      const asset = createMedia(app.db, {
        filename: result.file.filename,
        url,
        mimeType: result.file.mimeType,
        byteSize: result.file.bytes.length,
        source: "inspiration",
      });
      sendJson(ctx.res, 201, { id: asset.id, url: asset.url, maxBytes: MAX_UPLOAD_BYTES });
    }),

    route("POST", "/api/track", async (ctx) => {
      if (!app.limits.track.take(ctx.ip)) return tooMany(ctx.res);
      const input = (await body(ctx)) as { reference?: string; phone?: string };
      const reference = String(input?.reference ?? "").trim();
      const phone = String(input?.phone ?? "").trim();
      if (reference === "" || phone === "") {
        return badRequest(ctx.res, [
          { field: "reference", message: "Référence et téléphone sont nécessaires." },
        ]);
      }
      const order = findOrderForTracking(app.db, reference, phone);
      if (!order) return notFound(ctx.res, "Aucune commande ne correspond à ces informations.");
      ok(ctx.res, publicOrder(order));
    }),
  ];
}

/**
 * Where Grace's copy goes. With no address configured it falls back to the internal
 * channel, which still lands in the admin's notification list.
 */
function ownerRecipient(app: AppContext): string {
  return getSetting(app.db, "ownerNotificationEmail").trim() || "admin";
}

/** Acknowledge the customer, alert Grace. Never lets a delivery problem fail an order. */
async function announce(app: AppContext, order: Order): Promise<void> {
  const config = getPublicSettings(app.db);
  await deliver(app.db, app.transport, {
    audience: "owner",
    recipient: ownerRecipient(app),
    message: ownerAlert(order, config),
    orderId: order.id,
  });
  const email = order.customer?.email;
  await deliver(app.db, app.transport, {
    audience: "customer",
    recipient: email ?? order.customer?.phone ?? "—",
    message: customerAcknowledgement(order, config),
    orderId: order.id,
  });
}

export { BadJson, PayloadTooLarge };
