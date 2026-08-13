#!/usr/bin/env node
/**
 * Start Brandora.
 *
 * One process serves the site and the API, so the session cookie needs no CORS
 * and no cross-origin exemptions. See `app.ts` for why that matters.
 */

import { resolve } from "node:path";

import { describeConfig } from "@brandora/config";

import { createApp } from "../app.js";

const port = Number(process.env["PORT"] ?? 4100);
const staticRoot = process.env["BRANDORA_STATIC_ROOT"] ?? resolve(process.cwd(), "apps/brandora");

const app = createApp({ staticRoot });
const server = app.listen(port);

// Presence, never values (§29). `describeConfig` cannot return a credential.
console.log(`[brandora] listening on :${port}`);
console.log(`[brandora] serving ${staticRoot}`);
for (const [key, value] of Object.entries(describeConfig())) {
  console.log(`[brandora]   ${key}: ${value}`);
}

const shutdown = (signal: string): void => {
  console.log(`[brandora] ${signal} — closing`);
  server.close(() => {
    app.db.close();
    process.exit(0);
  });
  // A request that will not finish must not hold the process open forever.
  setTimeout(() => process.exit(0), 5_000).unref();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
