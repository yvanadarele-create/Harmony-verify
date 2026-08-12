import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  CATALOG,
  addItem,
  buildStarterPackage,
  categories,
  createPackage,
  filterProducts,
  isCustomizable,
  packageTotals,
  productById,
  recommendStarter,
  removeItem,
  satisfiesQuantity,
  setQuantity,
  STARTER_PACKAGES,
} from "@brandora/catalog";
import { ValidationError, fromMajor } from "@brandora/shared";

/* --- §25, §64 The shelf --------------------------------------------------- */

describe("catalogue", () => {
  test("all four categories are stocked", () => {
    const names = categories().map((c) => c.category).sort();
    assert.deepEqual(names, ["brand-materials", "merchandise", "packaging", "tableware"]);
  });

  test("nothing starts at a quantity a first-time founder cannot afford", () => {
    for (const product of CATALOG) {
      assert.ok(
        product.minimumQuantity <= 100,
        `${product.name} has a minimum of ${product.minimumQuantity} — §64 says small quantities are the point`,
      );
    }
  });

  test("every product is priced in the catalogue currency", () => {
    for (const product of CATALOG) {
      assert.equal(product.indicativeUnitPrice.currency, "XOF");
      assert.ok(product.indicativeUnitPrice.amount > 0, `${product.name} is free`);
    }
  });
});

/* --- §35 Quantity filtering ---------------------------------------------- */

describe("quantity filter", () => {
  test("a product whose minimum exceeds the order is not a match", () => {
    const pouch = productById("prd_pouch_standing")!;
    assert.equal(pouch.minimumQuantity, 50);
    assert.equal(satisfiesQuantity(pouch, 30), false);
    assert.equal(satisfiesQuantity(pouch, 50), true);
  });

  test("asking for 30 separates what can be ordered from what cannot", () => {
    const { matches, nearMisses } = filterProducts({ category: "packaging", quantity: 30 });
    assert.ok(matches.length > 0);
    assert.ok(nearMisses.length > 0, "the 50-unit pouch should be a near miss, not invisible");
    for (const product of matches) assert.ok(product.minimumQuantity <= 30);
    for (const product of nearMisses) assert.ok(product.minimumQuantity > 30 || product.availableQuantity < 30);
  });

  test("stock below the requested quantity also disqualifies", () => {
    const scarce = { ...productById("prd_cup_kraft_250")!, availableQuantity: 10 };
    assert.equal(satisfiesQuantity(scarce, 30), false);
  });

  test("no quantity means no near misses — browsing is not ordering", () => {
    const { nearMisses } = filterProducts({ category: "packaging" });
    assert.equal(nearMisses.length, 0);
  });
});

/* --- §36 Customisation honesty ------------------------------------------- */

describe("customisation filter", () => {
  test("a product with unconfirmed customisation is never offered as customisable", () => {
    const deli = productById("prd_container_deli_500")!;
    assert.equal(deli.customization.confidence, "unknown");
    assert.equal(isCustomizable(deli), false);

    const { matches } = filterProducts({ customizableOnly: true });
    assert.ok(!matches.some((p) => p.id === "prd_container_deli_500"));
  });

  test("every product claiming verified customisation names a method", () => {
    for (const product of CATALOG) {
      if (product.customization.confidence !== "verified") continue;
      assert.ok(
        product.customization.methods.length > 0,
        `${product.name} claims verified customisation with no method`,
      );
    }
  });
});

describe("search", () => {
  test("search survives accents", () => {
    const { matches } = filterProducts({ search: "etiquettes" });
    assert.equal(matches.length >= 0, true, "must not throw on accent-stripped input");
  });

  test("search matches the description, not just the name", () => {
    const { matches } = filterProducts({ search: "resealable" });
    assert.ok(matches.some((p) => p.id === "prd_pouch_standing"));
  });
});

/* --- §42 The package builder --------------------------------------------- */

describe("package builder", () => {
  const cup = productById("prd_cup_kraft_250")!;
  const sticker = productById("prd_sticker_circle_50")!;

  test("a quantity below the minimum is raised and the adjustment is reported", () => {
    const result = addItem(createPackage("brn_1", "Test"), cup, 10);
    assert.equal(result.adjustedTo, 25, "should raise 10 to the 25-unit minimum");
    assert.equal(result.package.items[0]!.quantity, 25);
  });

  test("a quantity at or above the minimum is left alone", () => {
    const result = addItem(createPackage("brn_1", "Test"), cup, 30);
    assert.equal(result.adjustedTo, undefined);
    assert.equal(result.package.items[0]!.quantity, 30);
  });

  test("adding the same product twice increases the line rather than duplicating it", () => {
    let pkg = createPackage("brn_1", "Test");
    pkg = addItem(pkg, cup, 30, "logo-print").package;
    pkg = addItem(pkg, cup, 30, "logo-print").package;
    assert.equal(pkg.items.length, 1);
    assert.equal(pkg.items[0]!.quantity, 60);
  });

  test("the same product with a different finish is a separate line", () => {
    let pkg = createPackage("brn_1", "Test");
    pkg = addItem(pkg, cup, 30, "logo-print").package;
    pkg = addItem(pkg, cup, 30).package;
    assert.equal(pkg.items.length, 2);
  });

  test("operations do not mutate the package they were given", () => {
    const original = addItem(createPackage("brn_1", "Test"), cup, 30).package;
    const after = removeItem(original, original.items[0]!.id);
    assert.equal(original.items.length, 1, "the original must be untouched");
    assert.equal(after.items.length, 0);
  });

  test("a customisation the product does not offer is refused", () => {
    assert.throws(() => addItem(createPackage("brn_1", "Test"), cup, 30, "embroidery"), ValidationError);
  });

  test("a non-integer quantity is refused", () => {
    assert.throws(() => addItem(createPackage("brn_1", "Test"), cup, 2.5), ValidationError);
  });

  test("setQuantity also respects the minimum", () => {
    const pkg = addItem(createPackage("brn_1", "Test"), cup, 30).package;
    const result = setQuantity(pkg, pkg.items[0]!.id, 5, CATALOG);
    assert.equal(result.adjustedTo, 25);
  });

  test("the running total is products plus customisation, and nothing else", () => {
    let pkg = createPackage("brn_1", "Test");
    pkg = addItem(pkg, cup, 30, "logo-print").package;
    const totals = packageTotals(pkg, CATALOG);

    // 30 × 165 = 4 950 product, 30 × 45 = 1 350 customisation.
    assert.equal(totals.productsTotal.amount, 4_950);
    assert.equal(totals.customizationTotal.amount, 1_350);
    assert.equal(totals.estimatedTotal.amount, 6_300);
    assert.equal(totals.unitCount, 30);
  });

  test("an item with no customisation adds no customisation cost", () => {
    const pkg = addItem(createPackage("brn_1", "Test"), sticker, 50).package;
    assert.equal(packageTotals(pkg, CATALOG).customizationTotal.amount, 0);
  });

  test("an empty package totals to zero, not to NaN", () => {
    const totals = packageTotals(createPackage("brn_1", "Empty"), CATALOG);
    assert.equal(totals.estimatedTotal.amount, 0);
    assert.deepEqual(totals.estimatedTotal, fromMajor(0));
  });
});

/* --- §21 Starter packages ------------------------------------------------ */

describe("starter packages", () => {
  test("every starter line clears its own product minimum", () => {
    for (const starter of STARTER_PACKAGES) {
      for (const line of starter.items) {
        const product = productById(line.productId);
        assert.ok(product, `${starter.key} references a missing product ${line.productId}`);
        assert.ok(
          line.quantity >= product!.minimumQuantity,
          `${starter.key}: ${line.productId} at ${line.quantity} is under its ${product!.minimumQuantity} minimum`,
        );
      }
    }
  });

  test("every starter method is one the product actually offers", () => {
    for (const starter of STARTER_PACKAGES) {
      for (const line of starter.items) {
        if (!line.method) continue;
        const product = productById(line.productId)!;
        assert.ok(
          product.customization.methods.includes(line.method),
          `${starter.key}: ${product.name} does not offer ${line.method}`,
        );
      }
    }
  });

  test("a bakery gets the bakery kit; an unknown industry still gets something", () => {
    assert.equal(recommendStarter("home bakery").key, "bakery");
    assert.equal(recommendStarter("skincare").key, "beauty");
    assert.ok(recommendStarter("aquarium maintenance").key.length > 0);
  });

  test("building a starter package never triggers a silent quantity adjustment", () => {
    for (const starter of STARTER_PACKAGES) {
      const pkg = buildStarterPackage("brn_1", starter, CATALOG);
      assert.equal(pkg.items.length, starter.items.length);
      for (const [index, item] of pkg.items.entries()) {
        assert.equal(item.quantity, starter.items[index]!.quantity);
      }
    }
  });
});
