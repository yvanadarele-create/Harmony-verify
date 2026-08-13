/**
 * The composition root.
 *
 * Everything that reads the environment happens here, once, at start-up — the
 * routes receive already-resolved values and never touch `process.env`. That is
 * what makes the whole API testable against an in-memory database, a stub
 * strategy provider and a fake payment transport, with no environment at all.
 *
 * It is also the only file that knows the site and the API share a process. A
 * single origin is a deliberate choice: it is what lets the session live in an
 * HttpOnly cookie the page's JavaScript cannot read, instead of in
 * `localStorage`, where any injected script can take it.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { AnthropicStrategyProvider, UnconfiguredStrategyProvider } from "@brandora/ai";
import type { StrategyProvider } from "@brandora/brand-engine";
import {
  aiConfigured,
  authSecret,
  databasePath,
  defaultCurrency,
  deliverySettings,
  logisticsRate,
  marginRate,
  publicBaseUrl,
} from "@brandora/config";
import { type Db, type Repositories, createRepositories, openDatabase } from "@brandora/database";
import { money } from "@brandora/shared";

import { type ServerLogger, consoleLogger, handle } from "./http.js";
import { type PaymentProvider, resolvePaymentProvider } from "./payments.js";
import type { PricingSettings } from "./pricing.js";
import { type ServerDeps, createRouter } from "./routes.js";
import { SECURITY_HEADERS, resolveStaticFile, sendStatic } from "./static.js";

export interface AppOptions {
  /** Absolute path to the static site. Omit to run API-only. */
  staticRoot?: string;
  /** Injected in tests. Defaults to the file named by BRANDORA_DATABASE_PATH. */
  db?: Db;
  strategy?: StrategyProvider;
  payments?: PaymentProvider;
  logger?: ServerLogger;
  env?: Record<string, string | undefined>;
  now?: () => Date;
  rateLimits?: ServerDeps["rateLimits"];
  /** Secure cookies. Defaults to on unless the base URL is plain http. */
  secureCookies?: boolean;
}

export interface BrandoraApp {
  listener: (req: IncomingMessage, res: ServerResponse) => void;
  repos: Repositories;
  db: Db;
  deps: ServerDeps;
  listen(port: number, host?: string): Server;
}

export function createApp(options: AppOptions = {}): BrandoraApp {
  const env = options.env ?? process.env;
  const logger = options.logger ?? consoleLogger;

  const db = options.db ?? openDatabaseAt(databasePath(env));
  const repos = createRepositories(db);

  const currency = defaultCurrency(env);
  const delivery = deliverySettings(env);

  const pricing: PricingSettings = {
    currency,
    serviceRate: marginRate(env),
    logisticsRate: logisticsRate(env),
    deliveryFlat: money(delivery.flat, currency),
    deliveryPerKg: money(delivery.perKg, currency),
    roundingStep: delivery.roundingStep,
  };

  const baseUrl = publicBaseUrl(env);

  const deps: ServerDeps = {
    repos,
    // Throws at start-up if unset, rather than at the first login. A server
    // that boots without a signing secret and fails later is a server that
    // fails in production at the worst possible moment.
    authSecret: authSecret(env),
    strategy: options.strategy ?? resolveStrategyProvider(env, logger),
    payments: options.payments ?? resolvePaymentProvider(env),
    pricing,
    publicBaseUrl: baseUrl,
    logger,
    env,
    ...(options.now ? { now: options.now } : {}),
    ...(options.rateLimits ? { rateLimits: options.rateLimits } : {}),
  };

  const router = createRouter(deps);
  const staticRoot = options.staticRoot ? resolve(options.staticRoot) : null;
  const secure = options.secureCookies ?? !baseUrl.startsWith("http://");

  const listener = (req: IncomingMessage, res: ServerResponse): void => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;

    // Static files are streamed directly rather than going through the router's
    // buffered result: the landing film is several megabytes, and a browser
    // seeking in it sends Range requests a JSON pipeline cannot answer.
    if (staticRoot && !path.startsWith("/api/") && (req.method === "GET" || req.method === "HEAD")) {
      const file = resolveStaticFile(staticRoot, path);
      if (file) {
        if (req.method === "HEAD") {
          res.writeHead(200, {
            "Content-Type": file.contentType,
            "Content-Length": String(file.size),
            ...SECURITY_HEADERS,
          });
          res.end();
          return;
        }
        sendStatic(res, file, { rangeHeader: req.headers.range });
        return;
      }
    }

    void handle(req, res, {
      router,
      cookies: { secure },
      logger,
      fallback: staticRoot
        ? (ctx) => {
            // An unknown page gets the landing page's HTML with a 404 status:
            // a customer who mistyped a link sees somewhere to go, and a crawler
            // is still told the URL does not exist. An unknown *API* path is
            // left alone so it answers in JSON, not HTML.
            if (ctx.method !== "GET" || ctx.path.startsWith("/api/")) return null;
            const index = resolveStaticFile(staticRoot, "/index.html");
            if (!index) return null;
            return {
              status: 404,
              raw: readFileSync(index.absolutePath),
              contentType: index.contentType,
              headers: SECURITY_HEADERS,
            };
          }
        : undefined,
    });
  };

  return {
    listener,
    repos,
    db,
    deps,
    listen(port, host = "0.0.0.0") {
      const server = createServer(listener);
      server.listen(port, host);
      return server;
    },
  };
}

function openDatabaseAt(location: string): Db {
  if (location !== ":memory:") mkdirSync(dirname(resolve(location)), { recursive: true });
  return openDatabase(location);
}

/**
 * Pick a strategy provider.
 *
 * With no key, `UnconfiguredStrategyProvider` fails every generation with a
 * clear admin message. It does not invent a brand — a fabricated name and story
 * is exactly what makes a demo look finished and a launch fail.
 */
function resolveStrategyProvider(
  env: Record<string, string | undefined>,
  logger: ServerLogger,
): StrategyProvider {
  if (!aiConfigured(env)) {
    logger.error("ANTHROPIC_API_KEY is not set — brand generation will refuse rather than fabricate");
    return new UnconfiguredStrategyProvider();
  }
  return new AnthropicStrategyProvider({
    onError: (detail) => logger.error(`ai: ${detail}`),
  });
}
