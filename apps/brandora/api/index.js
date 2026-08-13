/**
 * The Vercel serverless entry point.
 *
 * Vercel hands a Node function the same `IncomingMessage` and `ServerResponse`
 * that `node:http` does, so the application's listener runs here unchanged —
 * there is no second copy of the routing, the auth or the pricing.
 *
 * ⚠️ **Read `docs/brandora-deployment.md` before relying on this.** Brandora
 * stores its data in SQLite on the local filesystem, and a serverless
 * function's filesystem does not survive between invocations. On Vercel this
 * endpoint answers correctly and then forgets: an account created by one
 * request may not exist for the next. That is a property of the storage, not a
 * bug in this file, and it is why the deployment document recommends running
 * `@brandora/server` as one long-lived process on a host with a disk.
 *
 * The static site is served by Vercel's CDN, not by this function — `vercel.json`
 * only routes `/api/*` here.
 */

import { createApp } from '@brandora/server';

// Built once per cold start and reused across invocations on the same instance.
const app = createApp();

export default function handler(req, res) {
  return app.listener(req, res);
}
