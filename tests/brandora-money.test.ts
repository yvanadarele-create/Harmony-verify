import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  CURRENCY_EXPONENT,
  DEFAULT_CURRENCY,
  allocate,
  add,
  formatMoney,
  fromMajor,
  money,
  multiply,
  roundUpTo,
  subtract,
  sum,
  toMajor,
  CurrencyMismatchError,
} from "@brandora/shared";

/* --- §24 Multi-currency -------------------------------------------------- */

describe("money — zero-decimal currencies", () => {
  test("XOF has no minor unit, so 1500 FCFA is 1500 — not 150 000", () => {
    assert.equal(CURRENCY_EXPONENT.XOF, 0);
    const price = fromMajor(1_500, "XOF");
    assert.equal(price.amount, 1_500);
    assert.equal(toMajor(price), 1_500);
  });

  test("USD keeps two decimals, so 12.50 is 1250 cents", () => {
    const price = fromMajor(12.5, "USD");
    assert.equal(price.amount, 1_250);
    assert.equal(toMajor(price), 12.5);
  });

  test("the launch currency is FCFA but it is one constant, not an assumption", () => {
    assert.equal(DEFAULT_CURRENCY, "XOF");
    assert.equal(money(100).currency, "XOF");
  });

  test("a non-integer amount is a bug and is refused at construction", () => {
    assert.throws(() => money(12.5, "XOF"), RangeError);
  });
});

describe("money — arithmetic", () => {
  test("mixing currencies throws rather than producing a plausible wrong number", () => {
    assert.throws(() => add(money(100, "XOF"), money(100, "USD")), CurrencyMismatchError);
    assert.throws(() => subtract(money(100, "XOF"), money(100, "EUR")), CurrencyMismatchError);
  });

  test("multiply rounds to a whole minor unit", () => {
    assert.equal(multiply(money(333, "XOF"), 0.35).amount, 117);
  });

  test("sum of an empty list is zero in the requested currency", () => {
    assert.deepEqual(sum([], "USD"), { amount: 0, currency: "USD" });
  });

  test("roundUpTo never rounds down, so rounding cannot eat margin", () => {
    assert.equal(roundUpTo(money(14_730, "XOF"), 100).amount, 14_800);
    assert.equal(roundUpTo(money(14_800, "XOF"), 100).amount, 14_800, "already tidy, left alone");
  });
});

describe("money — allocate", () => {
  test("splitting loses nothing and invents nothing", () => {
    const parts = allocate(money(100, "XOF"), 3);
    assert.deepEqual(
      parts.map((p) => p.amount),
      [34, 33, 33],
    );
    assert.equal(sum(parts, "XOF").amount, 100);
  });

  test("a negative amount distributes its remainder the same way", () => {
    const parts = allocate(money(-100, "XOF"), 3);
    assert.equal(sum(parts, "XOF").amount, -100);
  });

  test("allocating across zero shares is refused", () => {
    assert.throws(() => allocate(money(100, "XOF"), 0), RangeError);
  });
});

describe("money — formatting", () => {
  test("FCFA trails the figure; a symbol leads it", () => {
    assert.match(formatMoney(money(15_000, "XOF"), "en"), /15,000 FCFA/);
    assert.match(formatMoney(money(1_250, "USD"), "en"), /^\$12\.50$/);
  });

  test("French grouping differs from English, and both are correct", () => {
    const fr = formatMoney(money(15_000, "XOF"), "fr");
    const en = formatMoney(money(15_000, "XOF"), "en");
    assert.notEqual(fr, en);
    assert.match(fr, /FCFA$/);
  });

  test("XOF is never rendered with decimals", () => {
    assert.doesNotMatch(formatMoney(money(1_500, "XOF"), "en"), /[.,]\d\d\b/);
  });
});
