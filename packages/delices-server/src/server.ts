/**
 * Assembles the application: route table, static hosting, error handling.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { purgeExpiredSessions } from "@delices/db";
import { buildLimiters, type AppContext, type AppOptions } from "./context.js";
import {
  BadJson,
  PayloadTooLarge,
  badRequest,
  clientIp,
  notFound,
  sendJson,
  serverError,
} from "./http.js";
import { storeOnlyTransport } from "./notify.js";
import { adminRoutes } from "./routes-admin.js";
import { publicRoutes } from "./routes-public.js";
import { matchRoute, type Route } from "./router.js";
import { serveStatic, serveUpload } from "./static-files.js";

export interface App {
  server: Server;
  context: AppContext;
  routes: Route[];
}

export function createApp(options: AppOptions): App {
  const context: AppContext = {
    db: options.db,
    webRoot: resolve(options.webRoot),
    uploadDir: resolve(options.uploadDir),
    transport: options.transport ?? storeOnlyTransport,
    secureCookies: options.secureCookies ?? false,
    limits: buildLimiters(),
  };

  purgeExpiredSessions(context.db);
  const routes = [...publicRoutes(context), ...adminRoutes(context)];

  const server = createServer((req, res) => {
    handle(context, routes, req, res).catch(() => {
      if (!res.headersSent) serverError(res);
      else res.end();
    });
  });

  return { server, context, routes };
}

async function handle(
  app: AppContext,
  routes: readonly Route[],
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const method = req.method ?? "GET";

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");

  if (url.pathname.startsWith("/api/")) {
    const match = matchRoute(routes, method, url.pathname);
    if (!match) return notFound(res, "Route inconnue.");
    try {
      await match.handler({ req, res, url, params: match.params, ip: clientIp(req) });
    } catch (error) {
      if (error instanceof PayloadTooLarge) {
        return sendJson(res, 413, { error: "Contenu trop volumineux." });
      }
      if (error instanceof BadJson) {
        return badRequest(res, [], "Données illisibles.");
      }
      throw error;
    }
    return;
  }

  if (method !== "GET" && method !== "HEAD") {
    return sendJson(res, 405, { error: "Méthode non autorisée." });
  }

  if (url.pathname.startsWith("/uploads/")) {
    const served = await serveUpload(res, app.uploadDir, url.pathname);
    if (served) return;
    return notFound(res, "Image introuvable.");
  }

  const served = await serveStatic(res, app.webRoot, url.pathname, { fallback404: "404.html" });
  if (!served) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Page introuvable");
  }
}
