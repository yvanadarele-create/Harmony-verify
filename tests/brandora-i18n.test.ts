import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  CATALOGUES,
  LOCALES,
  MESSAGE_KEYS,
  aiLanguageDirective,
  en,
  formatDate,
  negotiateLocale,
  translate,
  translator,
} from "@brandora/i18n";
import { CUSTOMER_MESSAGES, money } from "@brandora/shared";

/* --- §23 The three languages --------------------------------------------- */

describe("§23 — translation completeness", () => {
  test("all three languages ship", () => {
    assert.deepEqual([...LOCALES], ["en", "fr", "es"]);
  });

  test("no catalogue is missing a key", () => {
    for (const locale of LOCALES) {
      const missing = MESSAGE_KEYS.filter((key) => !(key in CATALOGUES[locale]));
      assert.deepEqual(missing, [], `${locale} is missing: ${missing.join(", ")}`);
    }
  });

  test("no catalogue has a key the English one does not", () => {
    for (const locale of LOCALES) {
      const extra = Object.keys(CATALOGUES[locale]).filter((key) => !(key in en));
      assert.deepEqual(extra, [], `${locale} has orphan keys: ${extra.join(", ")}`);
    }
  });

  test("no string was left untranslated by copy-paste", () => {
    // Some strings are legitimately identical across languages ("WhatsApp",
    // "Brandora"). A locale where most strings match English is not.
    for (const locale of ["fr", "es"] as const) {
      const identical = MESSAGE_KEYS.filter((key) => CATALOGUES[locale][key] === en[key]);
      assert.ok(
        identical.length < MESSAGE_KEYS.length * 0.2,
        `${locale}: ${identical.length} of ${MESSAGE_KEYS.length} strings are identical to English`,
      );
    }
  });

  test("every string is non-empty", () => {
    for (const locale of LOCALES) {
      for (const key of MESSAGE_KEYS) {
        assert.ok(CATALOGUES[locale][key].trim().length > 0, `${locale}.${key} is empty`);
      }
    }
  });

  test("placeholders survive translation", () => {
    const placeholders = (value: string): string[] => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
    for (const locale of LOCALES) {
      for (const key of MESSAGE_KEYS) {
        assert.deepEqual(
          placeholders(CATALOGUES[locale][key]),
          placeholders(en[key]),
          `${locale}.${key} has different placeholders from English`,
        );
      }
    }
  });

  test("every customer-facing error key has a translation", () => {
    for (const key of Object.keys(CUSTOMER_MESSAGES)) {
      const messageKey = `error.${key}`;
      assert.ok(MESSAGE_KEYS.includes(messageKey as never), `no translation for ${messageKey}`);
    }
  });
});

describe("translation", () => {
  test("placeholders are filled", () => {
    assert.equal(translate("en", "catalog.moq", { min: 30 }), "From 30 units");
    assert.equal(translate("fr", "catalog.moq", { min: 30 }), "À partir de 30 unités");
  });

  test("a missing variable stays visible rather than leaving a blank", () => {
    assert.match(translate("en", "catalog.moq"), /\{min\}/);
  });

  test("the curried form resolves the locale once", () => {
    const t = translator("es");
    assert.equal(t("nav.catalog"), "Catálogo");
  });

  test("the whole interface translates, not just the marketing", () => {
    for (const key of ["checkout.submit", "order.status.shipped", "settings.currency", "error.internal"] as const) {
      assert.notEqual(translate("fr", key), translate("en", key), `${key} is not translated`);
    }
  });
});

describe("locale negotiation", () => {
  test("an exact match wins", () => {
    assert.equal(negotiateLocale("fr"), "fr");
  });

  test("a regional variant falls back to its base language", () => {
    assert.equal(negotiateLocale("fr-CI,fr;q=0.9"), "fr");
    assert.equal(negotiateLocale("es-MX"), "es");
  });

  test("an unsupported language gets English rather than an error", () => {
    assert.equal(negotiateLocale("pt-BR,pt;q=0.9"), "en");
    assert.equal(negotiateLocale(null), "en");
    assert.equal(negotiateLocale(""), "en");
  });

  test("the first supported language in the header wins", () => {
    assert.equal(negotiateLocale("pt-BR,es;q=0.8,en;q=0.5"), "es");
  });
});

describe("formatting follows the reader's language", () => {
  test("money", () => {
    assert.notEqual(
      translate("fr", "package.total") + money(15_000, "XOF").amount,
      translate("en", "package.total") + money(15_000, "XOF").amount,
    );
  });

  test("dates", () => {
    const iso = "2026-03-15T00:00:00Z";
    assert.match(formatDate(iso, "en"), /March/);
    assert.match(formatDate(iso, "fr"), /mars/);
    assert.match(formatDate(iso, "es"), /marzo/);
  });

  test("the assistant is told which language to answer in", () => {
    assert.match(aiLanguageDirective("fr"), /Reply in French/);
    assert.match(aiLanguageDirective("es"), /Reply in Spanish/);
  });
});
