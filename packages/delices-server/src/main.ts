/**
 * Entry point.
 *
 * Reads its configuration from the environment (see `.env.example`), opens the
 * database, applies the baseline seed and starts listening. The first owner account
 * is created from `DELICES_OWNER_EMAIL` / `DELICES_OWNER_PASSWORD` only when the
 * database has no users at all, so restarting never resets a password.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { openDatabase, seedBaseline, seedDemoCatalogue, seedOwner, countUsers } from "@delices/db";
import { createApp } from "./server.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

const env = (key: string, fallback = ""): string => process.env[key]?.trim() || fallback;

const port = Number(env("PORT", "4100"));
const dbPath = env("DELICES_DB", resolve(repoRoot, "data/delices.db"));
const webRoot = env("DELICES_WEB_ROOT", resolve(repoRoot, "apps/delices"));
const uploadDir = env("DELICES_UPLOAD_DIR", resolve(repoRoot, "data/uploads"));

mkdirSync(dirname(dbPath), { recursive: true });
mkdirSync(uploadDir, { recursive: true });

const db = openDatabase(dbPath);
seedBaseline(db);

if (env("DELICES_SEED_DEMO") === "1") {
  seedDemoCatalogue(db);
  console.log("Catalogue de démonstration ajouté.");
}

const ownerEmail = env("DELICES_OWNER_EMAIL");
const ownerPassword = env("DELICES_OWNER_PASSWORD");
if (ownerEmail && ownerPassword.length >= 10) {
  const { created } = seedOwner(db, {
    name: env("DELICES_OWNER_NAME", "Grace"),
    email: ownerEmail,
    password: ownerPassword,
  });
  if (created) console.log(`Compte propriétaire créé : ${ownerEmail}`);
} else if (countUsers(db) === 0) {
  console.warn(
    "Aucun compte administrateur. Renseignez DELICES_OWNER_EMAIL et DELICES_OWNER_PASSWORD " +
      "(10 caractères minimum) puis redémarrez.",
  );
}

const { server } = createApp({
  db,
  webRoot,
  uploadDir,
  secureCookies: env("DELICES_SECURE_COOKIES") === "1",
});

server.listen(port, () => {
  console.log(`Les Délices de Grace Lumière — http://localhost:${port}`);
  console.log(`Administration — http://localhost:${port}/admin/`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
