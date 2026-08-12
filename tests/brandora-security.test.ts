import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  MissingConfigError,
  aliexpressAppSecret,
  aliexpressConfigured,
  aliexpressIntegrationStatus,
  describeConfig,
  marginRate,
  maskCredential,
  sourcingThresholds,
} from "@brandora/config";
import { BrandoraError, ForbiddenError, redact, toBrandoraError } from "@brandora/shared";

/* --- §29 Credentials ----------------------------------------------------- */

describe("§29 — credentials come from the environment, never from code", () => {
  test("a missing secret fails loudly at the point of use", () => {
    assert.throws(
      () => aliexpressAppSecret({}),
      (err: unknown) => err instanceof MissingConfigError && err.key === "ALIEXPRESS_APP_SECRET",
    );
  });

  test("the failure tells an admin where to set it, without hinting at a value", () => {
    try {
      aliexpressAppSecret({});
      assert.fail("should have thrown");
    } catch (err) {
      assert.match((err as Error).message, /encrypted environment settings/);
    }
  });

  test("connection status is derivable without reading a secret into a caller's hands", () => {
    assert.equal(aliexpressConfigured({}), false);
    assert.equal(
      aliexpressConfigured({
        ALIEXPRESS_APP_KEY: "k",
        ALIEXPRESS_APP_SECRET: "s",
        ALIEXPRESS_ACCESS_TOKEN: "t",
      }),
      true,
    );
  });

  test("whitespace-only values do not count as configured", () => {
    assert.equal(
      aliexpressConfigured({ ALIEXPRESS_APP_KEY: "  ", ALIEXPRESS_APP_SECRET: "s", ALIEXPRESS_ACCESS_TOKEN: "t" }),
      false,
    );
  });
});

/* --- §30 The admin integration page -------------------------------------- */

describe("§30 — the admin page shows masks, never values", () => {
  // Secret-shaped, not a secret: 32 mixed-case alphanumerics, the same shape as
  // an AliExpress app secret. A test fixture is committed forever, so it must
  // never be a value that was ever real anywhere.
  const secret = "FAKEsecretFAKEsecretFAKEsecret12";
  const status = aliexpressIntegrationStatus({
    ALIEXPRESS_APP_KEY: "example_app_key_000000",
    ALIEXPRESS_APP_SECRET: secret,
    ALIEXPRESS_ACCESS_TOKEN: "example_token_50000401abcd",
  });

  test("it reports connected without exposing anything", () => {
    assert.equal(status.connected, true);
    assert.equal(status.name, "AliExpress");
  });

  test("no field on the page contains any part of the secret beyond the last four", () => {
    const rendered = JSON.stringify(status);
    assert.ok(!rendered.includes(secret), "the secret itself is on the page");
    assert.ok(!rendered.includes(secret.slice(0, 8)), "a usable prefix is on the page");
    assert.ok(rendered.includes(secret.slice(-4)), "the last four should be there to identify the key");
  });

  test("an unset credential reads as unset rather than as a mask", () => {
    assert.equal(maskCredential(undefined), "Not set");
    assert.equal(maskCredential(""), "Not set");
  });

  test("a short value is masked completely — four of eight characters is a head start", () => {
    assert.equal(maskCredential("short123"), "••••••••");
    assert.doesNotMatch(maskCredential("short123"), /123/);
  });

  test("describeConfig reports presence, never values", () => {
    const described = describeConfig({
      ALIEXPRESS_APP_KEY: "k",
      ALIEXPRESS_APP_SECRET: secret,
      ALIEXPRESS_ACCESS_TOKEN: "t",
      ANTHROPIC_API_KEY: "sk-ant-real-key",
    });
    const rendered = JSON.stringify(described);
    assert.ok(!rendered.includes(secret));
    assert.ok(!rendered.includes("sk-ant-real-key"));
    assert.equal(described["aliexpress"], "configured");
  });
});

/* --- §61, §77 Nothing credential-shaped reaches a log -------------------- */

describe("redaction", () => {
  test("a signed query string echoed by a supplier is stripped", () => {
    const echoed =
      "request failed: app_key=example_key&sign=A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0C1D2E3F4A5B6C7D8E9F0A1B2&access_token=example_abcdefghijklmnop";
    const clean = redact(echoed);
    assert.doesNotMatch(clean, /example_abcdefghijklmnop/);
    assert.doesNotMatch(clean, /A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0C1D2E3F4A5B6C7D8E9F0A1B2/);
  });

  test("a bearer token is stripped", () => {
    assert.doesNotMatch(redact("Authorization: Bearer abcdef1234567890xyz"), /abcdef1234567890xyz/);
  });

  test("an app secret is stripped whatever the separator", () => {
    const secret = "FAKEsecretFAKEsecretFAKEsecret12";
    assert.doesNotMatch(redact(`app_secret: ${secret}`), new RegExp(secret));
    assert.doesNotMatch(redact(`appSecret=${secret}`), new RegExp(secret));
  });

  test("ordinary technical detail survives, so redaction does not blind the admin", () => {
    assert.match(redact("aliexpress.ds.product.get: HTTP 502"), /HTTP 502/);
  });

  test("every BrandoraError redacts its detail on construction", () => {
    const error = new BrandoraError("sourcing.unavailable", "failed with access_token=abcdef1234567890");
    assert.doesNotMatch(error.technicalDetail, /abcdef1234567890/);
  });
});

/* --- §73 The customer never sees a raw supplier error -------------------- */

describe("§73 — error surfaces", () => {
  test("an unexpected error becomes a customer sentence, not a supplier code", () => {
    const error = toBrandoraError(new Error("AliExpress error 403928: invalid signature"));
    assert.equal(error.toCustomerJSON().message, "Something went wrong on our side. We're on it.");
    assert.doesNotMatch(error.toCustomerJSON().message, /403928|AliExpress/);
  });

  test("the admin view keeps the detail the customer view drops", () => {
    const error = toBrandoraError(new Error("AliExpress error 403928"));
    assert.match(error.toAdminJSON().detail, /403928/);
  });

  test("the customer payload has exactly two keys and no technical field", () => {
    const payload = new BrandoraError("sourcing.unavailable", "internal detail").toCustomerJSON();
    assert.deepEqual(Object.keys(payload).sort(), ["error", "message"]);
    assert.ok(!JSON.stringify(payload).includes("internal detail"));
  });

  test("a forbidden error does not describe what it is protecting", () => {
    const error = new ForbiddenError("user usr_1 tried to read /admin/orders");
    assert.equal(error.status, 403);
    assert.doesNotMatch(error.toCustomerJSON().message, /admin|orders|usr_1/);
  });
});

/* --- §29 Repository hygiene ---------------------------------------------- */

describe("§29 — no credential is a literal in this repository", () => {
  // These tests compile into tests/dist, so the repository root is found by
  // walking up to the workspace manifest rather than by counting directories.
  function repositoryRoot(): string {
    let dir = import.meta.dirname;
    for (let i = 0; i < 6; i += 1) {
      try {
        const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string };
        if (manifest.name === "harmony-verify") return dir;
      } catch {
        // Not a manifest directory; keep walking.
      }
      dir = join(dir, "..");
    }
    throw new Error("could not locate the repository root");
  }

  const root = repositoryRoot();

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (["node_modules", ".git", "dist", ".next", ".turbo"].includes(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|js|mjs|json|html|css|md)$/.test(entry)) out.push(full);
    }
    return out;
  }

  const files = walk(root);

  test("the repository has files to scan", () => {
    assert.ok(files.length > 50, `only found ${files.length} files — the walk is broken`);
  });

  test("no ALIEXPRESS_* variable is assigned a real-looking value anywhere", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      // An assignment whose value is not a placeholder and not an empty template line.
      const matches = content.matchAll(/ALIEXPRESS_(?:APP_SECRET|ACCESS_TOKEN|REFRESH_TOKEN)\s*[=:]\s*["']?([A-Za-z0-9_-]{12,})/g);
      for (const match of matches) {
        const value = match[1] ?? "";
        if (/replace_me|placeholder|your_|example|test-|redacted/i.test(value)) continue;
        offenders.push(`${file}: ${value.slice(0, 8)}…`);
      }
    }
    assert.deepEqual(offenders, [], `credential-shaped assignments found:\n${offenders.join("\n")}`);
  });

  test("the front end never references a secret variable name", () => {
    const webDir = join(root, "apps", "brandora");
    let scanned = 0;
    for (const file of walk(webDir)) {
      scanned += 1;
      const content = readFileSync(file, "utf8");
      for (const forbidden of ["ALIEXPRESS_APP_SECRET", "ALIEXPRESS_ACCESS_TOKEN", "ALIEXPRESS_REFRESH_TOKEN", "ANTHROPIC_API_KEY"]) {
        assert.ok(!content.includes(forbidden), `${file} mentions ${forbidden}`);
      }
    }
    assert.ok(scanned > 0, "no front-end files were scanned");
  });
});

/* --- §66 Tunables are configuration, not constants ------------------------ */

describe("§66 — business numbers are settings", () => {
  test("the margin can be changed without a code change", () => {
    assert.equal(marginRate({}), 0.35);
    assert.equal(marginRate({ BRANDORA_MARGIN_RATE: "0.42" }), 0.42);
  });

  test("a nonsense value falls back rather than producing NaN prices", () => {
    assert.equal(marginRate({ BRANDORA_MARGIN_RATE: "not a number" }), 0.35);
  });

  test("the sourcing thresholds are configurable", () => {
    assert.deepEqual(sourcingThresholds({}), { smallMax: 50, mediumMax: 500 });
    assert.deepEqual(
      sourcingThresholds({ BRANDORA_SOURCING_SMALL_MAX: "20", BRANDORA_SOURCING_MEDIUM_MAX: "200" }),
      { smallMax: 20, mediumMax: 200 },
    );
  });
});
