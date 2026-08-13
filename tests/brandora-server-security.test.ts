/**
 * Security properties of the server layer.
 *
 * `brandora-api.test.ts` proves these hold over HTTP. This file proves the
 * pieces hold on their own, and adds the ones a request-level test cannot see:
 * path traversal on the static handler, cookie forgery, webhook signatures, and
 * a source scan that fails if a route ever grows a line that reads an identity
 * or an amount out of a request body.
 *
 * The scans are the part worth keeping. A test that a specific route is safe
 * ages the moment someone adds the next route; a test that *no* route can name
 * a price does not.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync, readdirSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHmac } from "node:crypto";

import {
  AmountMismatchError,
  ManualTransferProvider,
  assertAmountMatches,
  paystackSignatureValid,
  priceProject,
  resolveStaticFile,
  signValue,
  unsignValue,
} from "@brandora/server";
import { CATALOG } from "@brandora/catalog";
import { money } from "@brandora/shared";

/**
 * The repository root, found rather than assumed.
 *
 * These tests run from `tests/dist`, so counting `..` is one refactor away from
 * silently scanning nothing and passing. Walking up to the workspace file
 * cannot drift.
 */
const REPO = (() => {
  let current = import.meta.dirname ?? process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current;
    current = resolve(current, "..");
  }
  throw new Error("could not locate the repository root");
})();

/* --- Session cookies -------------------------------------------------------- */

describe("session cookies cannot be forged", () => {
  const secret = "a-signing-secret-for-tests";

  it("round-trips a value it signed", () => {
    assert.equal(unsignValue(signValue("tok_abc", secret), secret), "tok_abc");
  });

  it("rejects a changed value", () => {
    const signed = signValue("tok_abc", secret);
    const tampered = signed.replace("tok_abc", "tok_xyz");
    assert.equal(unsignValue(tampered, secret), null);
  });

  it("rejects a changed signature", () => {
    const signed = signValue("tok_abc", secret);
    assert.equal(unsignValue(`${signed}x`, secret), null);
  });

  it("rejects a value signed with a different secret", () => {
    assert.equal(unsignValue(signValue("tok_abc", "another-secret"), secret), null);
  });

  it("rejects an unsigned value", () => {
    assert.equal(unsignValue("tok_abc", secret), null);
    assert.equal(unsignValue("", secret), null);
    assert.equal(unsignValue(undefined, secret), null);
  });

  it("does not accept a signature of a different length as a prefix match", () => {
    const signed = signValue("tok_abc", secret);
    const truncated = signed.slice(0, signed.lastIndexOf(".") + 6);
    assert.equal(unsignValue(truncated, secret), null);
  });
});

/* --- Static files ----------------------------------------------------------- */

describe("the static handler stays inside its root", () => {
  const root = mkdtempSync(join(tmpdir(), "brandora-static-"));
  mkdirSync(join(root, "assets"), { recursive: true });
  writeFileSync(join(root, "index.html"), "<!doctype html>site");
  writeFileSync(join(root, "assets", "app.css"), "body{}");

  // A file the handler must never reach, one directory above the root.
  const secretPath = join(root, "..", `brandora-secret-${process.pid}.txt`);
  writeFileSync(secretPath, "SECRET");

  it("serves a file inside the root", () => {
    assert.ok(resolveStaticFile(root, "/assets/app.css"));
    assert.ok(resolveStaticFile(root, "/"));
  });

  it("resolves a clean URL to its page", () => {
    const file = resolveStaticFile(root, "/index");
    assert.ok(file);
    assert.ok(file.absolutePath.endsWith("index.html"));
  });

  it("refuses every traversal shape", () => {
    const attempts = [
      "/../brandora-secret.txt",
      "/../../etc/passwd",
      "/assets/../../etc/passwd",
      "/%2e%2e/%2e%2e/etc/passwd",
      "/..%2f..%2fetc%2fpasswd",
      "/....//....//etc/passwd",
      "/assets/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
    ];
    for (const attempt of attempts) {
      const file = resolveStaticFile(root, attempt);
      assert.equal(file, null, `${attempt} resolved to ${file?.absolutePath}`);
    }
  });

  it("refuses a directory", () => {
    assert.equal(resolveStaticFile(root, "/assets"), null);
  });
});

/* --- Payments --------------------------------------------------------------- */

describe("payments refuse anything that does not match", () => {
  it("refuses a different amount", () => {
    assert.throws(
      () => assertAmountMatches(money(150_000, "XOF"), money(100, "XOF")),
      AmountMismatchError,
    );
  });

  it("refuses a different currency at the same number", () => {
    assert.throws(
      () => assertAmountMatches(money(1_500, "XOF"), money(1_500, "USD")),
      AmountMismatchError,
    );
  });

  it("refuses when the provider reported no amount at all", () => {
    assert.throws(() => assertAmountMatches(money(1_500, "XOF"), null));
  });

  it("accepts an exact match", () => {
    assert.doesNotThrow(() => assertAmountMatches(money(1_500, "XOF"), money(1_500, "XOF")));
  });

  it("never settles a manual transfer", async () => {
    const provider = new ManualTransferProvider();
    const result = await provider.verify();
    assert.equal(result.paid, false);
    assert.equal(provider.configured, false);

    const intent = await provider.initialise({ reference: "ORD-2026-0001-P01" });
    assert.equal(intent.authorizationUrl, null, "an unconfigured provider offered a payment URL");
  });
});

describe("webhook signatures", () => {
  const secret = "sk_test_not_a_real_key";
  const body = JSON.stringify({ event: "charge.success", data: { reference: "ORD-1" } });
  const valid = createHmac("sha512", secret).update(body, "utf8").digest("hex");

  it("accepts a genuine signature", () => {
    assert.equal(paystackSignatureValid(body, valid, secret), true);
  });

  it("rejects a missing signature", () => {
    assert.equal(paystackSignatureValid(body, undefined, secret), false);
  });

  it("rejects a signature over a different body", () => {
    const otherBody = JSON.stringify({ event: "charge.success", data: { reference: "ORD-2" } });
    assert.equal(paystackSignatureValid(otherBody, valid, secret), false);
  });

  it("rejects a signature made with a different key", () => {
    const forged = createHmac("sha512", "sk_test_wrong").update(body, "utf8").digest("hex");
    assert.equal(paystackSignatureValid(body, forged, secret), false);
  });
});

/* --- Pricing ---------------------------------------------------------------- */

describe("pricing accepts intent, never amounts", () => {
  const settings = {
    currency: "XOF" as const,
    serviceRate: 0.35,
    logisticsRate: 0.08,
    deliveryFlat: money(3_000, "XOF"),
    deliveryPerKg: money(1_200, "XOF"),
    roundingStep: 100,
  };

  const product = CATALOG.find((entry) => entry.status === "active");
  assert.ok(product);

  it("ignores extra fields a caller invents", () => {
    const honest = priceProject([{ productId: product.id, quantity: 50 }], CATALOG, settings);
    const tampered = priceProject(
      [
        {
          productId: product.id,
          quantity: 50,
          // None of these exist on RequestedLine. TypeScript would reject them
          // in application code; this proves the runtime ignores them too.
          ...({ unitPrice: 1, total: 1, price: 1, amount: 1 } as Record<string, number>),
        },
      ],
      CATALOG,
      settings,
    );
    assert.equal(tampered.total.amount, honest.total.amount);
  });

  it("refuses an unknown product rather than dropping the line", () => {
    assert.throws(() => priceProject([{ productId: "prd_not_real", quantity: 10 }], CATALOG, settings));
  });

  it("refuses a negative or fractional quantity", () => {
    for (const quantity of [-5, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => priceProject([{ productId: product.id, quantity }], CATALOG, settings),
        `quantity ${quantity} was accepted`,
      );
    }
  });

  it("keeps the lines reconciling with the total", () => {
    const priced = priceProject([{ productId: product.id, quantity: 60 }], CATALOG, settings);
    const parts =
      priced.productsTotal.amount +
      priced.customizationTotal.amount +
      priced.shippingTotal.amount +
      priced.logisticsTotal.amount +
      priced.serviceTotal.amount;
    assert.equal(parts, priced.total.amount);
  });
});

/* --- Source scans ------------------------------------------------------------ */

function read(path: string): string {
  return readFileSync(join(REPO, path), "utf8");
}

function filesUnder(dir: string, pattern: RegExp): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(join(REPO, current), { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const next = `${current}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (pattern.test(entry.name)) out.push(next);
    }
  };
  walk(dir);
  return out;
}

describe("no route can be told who you are or what to charge", () => {
  const routes = read("packages/brandora-server/src/routes.ts");

  it("never reads an identity out of a request", () => {
    // `ctx.body["userId"]`, `requireString(ctx.body, "userId")` and friends.
    const patterns = [
      /body\s*\[\s*["']user_?[iI]d["']\s*\]/,
      /\bctx\.body\s*\.\s*userId\b/,
      /["'`]userId["'`]\s*,\s*\d+\s*\)/,
      /requireString\(\s*ctx\.body\s*,\s*["'](userId|user_id|role|email_as)["']/,
      /query\.get\(\s*["'](userId|user_id)["']\s*\)/,
    ];
    for (const pattern of patterns) {
      assert.equal(pattern.test(routes), false, `routes.ts matches ${pattern}`);
    }
  });

  it("never reads a price, total or amount out of a request", () => {
    const patterns = [
      /body\s*\[\s*["'](amount|total|price|unitPrice|subtotal|margin|currency)["']\s*\]/,
      /require(String|Integer)\(\s*ctx\.body\s*,\s*["'](amount|total|price|unitPrice|subtotal|margin)["']/,
      /optionalString\(\s*ctx\.body\s*,\s*["'](amount|total|price|currency)["']/,
    ];
    for (const pattern of patterns) {
      assert.equal(pattern.test(routes), false, `routes.ts matches ${pattern}`);
    }
  });

  it("never writes a role from a request", () => {
    assert.equal(/setRole\([^)]*ctx\.body/.test(routes), false);
    assert.equal(/role:\s*(ctx\.body|body\[)/.test(routes), false);
  });

  it("puts every customer read behind an owner or an admin", () => {
    // Any `findAsAdmin` / `listAsAdmin` must be inside a handler that called
    // requireAdmin. Checked by proximity: the admin reads all live in the block
    // after the admin section marker.
    const adminSection = routes.indexOf("/* --- Admin");
    assert.ok(adminSection > 0, "the admin section marker moved");

    const before = routes.slice(0, adminSection);
    const strayAdminReads = [...before.matchAll(/\.(findAsAdmin|listAsAdmin)\(/g)].map((m) => m[0]);
    assert.deepEqual(strayAdminReads, [], `admin-scoped reads outside the admin section: ${strayAdminReads}`);
  });

  it("guards every admin route", () => {
    const adminRoutes = [...routes.matchAll(/router\.(get|post|patch|put|delete)\("\/api\/admin[^"]*"/g)];
    assert.ok(adminRoutes.length >= 6, "the admin routes moved or shrank");

    // Every admin handler body must call requireAdmin. Sliced between one route
    // registration and the next.
    const positions = adminRoutes.map((match) => match.index ?? 0);
    positions.forEach((start, index) => {
      const end = positions[index + 1] ?? routes.length;
      const handler = routes.slice(start, end);
      assert.ok(
        handler.includes("requireAdmin"),
        `an /api/admin route does not call requireAdmin: ${handler.slice(0, 80)}`,
      );
    });
  });
});

describe("the browser never holds application data or a secret", () => {
  const scripts = filesUnder("apps/brandora/assets/js", /\.js$/).filter(
    (path) => !path.includes("/generated/"),
  );

  it("has scripts to check", () => {
    assert.ok(scripts.length >= 8, `only found ${scripts.length} scripts`);
  });

  it("stores no brand, package, quote or order in the browser", () => {
    const FORBIDDEN_KEYS = /(setItem|getItem)\(\s*['"`][^'"`]*(brand\.|identity|package|quote|order|basket|cart)/i;

    for (const path of scripts) {
      const source = read(path);
      const matches = [...source.matchAll(new RegExp(FORBIDDEN_KEYS, "gi"))].map((m) => m[0]);
      assert.deepEqual(
        matches,
        [],
        `${path} keeps application data in browser storage: ${matches.join(", ")}`,
      );
    }
  });

  it("only stores a theme, a locale, the current project and the interview draft", () => {
    const allowed = new Set([
      "brandora.theme",
      "brandora.locale",
      "brandora.project",
      "brandora.interview.draft",
    ]);

    for (const path of scripts) {
      const source = read(path);
      for (const match of source.matchAll(/(?:localStorage|sessionStorage)\.\w+\(\s*([A-Za-z_$][\w$]*|['"`][^'"`]+['"`])/g)) {
        const raw = (match[1] ?? "").replace(/['"`]/g, "");
        // Constants are resolved by looking up their declaration in the file.
        const declared = new RegExp(
          `(?:const|let|var)\\s+${raw}\\s*=\\s*['"\`]([^'"\`]+)['"\`]`,
        ).exec(source);
        const key = declared ? (declared[1] as string) : raw;
        assert.ok(allowed.has(key), `${path} stores an unexpected key: ${key}`);
      }
    }
  });

  it("names no credential", () => {
    const FORBIDDEN = [
      "ALIEXPRESS_APP_SECRET",
      "ALIEXPRESS_ACCESS_TOKEN",
      "ALIEXPRESS_REFRESH_TOKEN",
      "ANTHROPIC_API_KEY",
      "PAYSTACK_SECRET_KEY",
      "BRANDORA_AUTH_SECRET",
    ];
    for (const path of [...scripts, ...filesUnder("apps/brandora", /\.html$/)]) {
      const source = read(path);
      for (const secret of FORBIDDEN) {
        assert.equal(source.includes(secret), false, `${path} names ${secret}`);
      }
    }
  });

  it("sends the session as a cookie rather than a header it could read", () => {
    const client = read("apps/brandora/assets/js/api.js");
    assert.ok(client.includes("same-origin"), "the API client does not send credentials same-origin");
    assert.equal(/Authorization\s*:/.test(client), false, "the browser is building an auth header");
    assert.equal(/document\.cookie/.test(client), false, "the browser is reading cookies");
  });
});

describe("the server never reads the environment outside config", () => {
  it("keeps process.env in the composition root", () => {
    const sources = filesUnder("packages/brandora-server/src", /\.ts$/);
    for (const path of sources) {
      if (path.endsWith("/app.ts") || path.endsWith("/bin/serve.ts")) continue;

      const source = read(path);
      for (const match of source.matchAll(/process\.env\b/g)) {
        // `payments.ts` and `routes.ts` take the environment as a defaulted
        // parameter or a fallback so a test can pass its own. That is the only
        // shape allowed: `= process.env` or `?? process.env`, never a direct read.
        const before = source.slice(Math.max(0, (match.index ?? 0) - 60), match.index ?? 0);
        assert.ok(
          /(=|\?\?)\s*$/.test(before),
          `${path} reads process.env directly: …${before.slice(-60).replace(/\s+/g, " ")}process.env`,
        );
      }
    }
  });
});
