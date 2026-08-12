/**
 * The Brand Package Builder (§42).
 *
 * Everything here is pure: each operation returns a new package rather than
 * mutating one. That is what makes "undo" trivial, and what keeps the running
 * total impossible to get out of step with the items — the total is derived from
 * the items on every read rather than maintained alongside them.
 *
 * Quantities are clamped up to the product's minimum rather than rejected. A
 * founder who types 10 against a 25-unit minimum should see 25 and a note
 * explaining it, not an error that makes them start again.
 */

import {
  type BrandPackage,
  type BrandoraProduct,
  type CurrencyCode,
  type CustomizationMethod,
  type Money,
  type PackageItem,
  DEFAULT_CURRENCY,
  ValidationError,
  add,
  money,
  multiply,
  newId,
  zero,
} from "@brandora/shared";

export function createPackage(
  brandId: string,
  name: string,
  currency: CurrencyCode = DEFAULT_CURRENCY,
  now: Date = new Date(),
): BrandPackage {
  const timestamp = now.toISOString();
  return {
    id: newId("package"),
    brandId,
    name,
    items: [],
    currency,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export interface AddResult {
  package: BrandPackage;
  /** Set when the requested quantity was raised to meet the minimum. */
  adjustedTo?: number;
}

export function addItem(
  pkg: BrandPackage,
  product: BrandoraProduct,
  quantity: number,
  method?: CustomizationMethod,
  now: Date = new Date(),
): AddResult {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new ValidationError("quantity", `expected a positive whole number, got ${quantity}`);
  }
  if (product.indicativeUnitPrice.currency !== pkg.currency) {
    throw new ValidationError(
      "currency",
      `product is priced in ${product.indicativeUnitPrice.currency}, package is in ${pkg.currency}`,
    );
  }
  if (method && !product.customization.methods.includes(method)) {
    throw new ValidationError("method", `${product.name} does not offer ${method}`);
  }

  const effective = Math.max(quantity, product.minimumQuantity);
  const adjusted = effective !== quantity;

  // Adding a product already in the package increases its quantity rather than
  // creating a second line — two lines of the same cup is not a thing a
  // customer means, and it breaks the per-unit price break later.
  const existing = pkg.items.find((item) => item.productId === product.id && item.customizationMethod === method);

  const items = existing
    ? pkg.items.map((item) =>
        item.id === existing.id ? { ...item, quantity: item.quantity + effective } : item,
      )
    : [
        ...pkg.items,
        {
          id: newId("packageItem"),
          productId: product.id,
          name: product.name,
          quantity: effective,
          unitPrice: product.indicativeUnitPrice,
          customizationMethod: method,
        } satisfies PackageItem,
      ];

  return {
    package: { ...pkg, items, updatedAt: now.toISOString() },
    ...(adjusted ? { adjustedTo: effective } : {}),
  };
}

export function removeItem(pkg: BrandPackage, itemId: string, now: Date = new Date()): BrandPackage {
  return {
    ...pkg,
    items: pkg.items.filter((item) => item.id !== itemId),
    updatedAt: now.toISOString(),
  };
}

export function setQuantity(
  pkg: BrandPackage,
  itemId: string,
  quantity: number,
  products: readonly BrandoraProduct[],
  now: Date = new Date(),
): AddResult {
  const item = pkg.items.find((i) => i.id === itemId);
  if (!item) throw new ValidationError("itemId", `no item ${itemId} in this package`);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new ValidationError("quantity", `expected a positive whole number, got ${quantity}`);
  }

  const product = products.find((p) => p.id === item.productId);
  const minimum = product?.minimumQuantity ?? 1;
  const effective = Math.max(quantity, minimum);

  return {
    package: {
      ...pkg,
      items: pkg.items.map((i) => (i.id === itemId ? { ...i, quantity: effective } : i)),
      updatedAt: now.toISOString(),
    },
    ...(effective !== quantity ? { adjustedTo: effective } : {}),
  };
}

export interface PackageTotals {
  productsTotal: Money;
  customizationTotal: Money;
  /** Products plus customisation. Shipping and service are added at quote time. */
  estimatedTotal: Money;
  unitCount: number;
  lineCount: number;
}

/**
 * The running total shown in the builder.
 *
 * Deliberately *not* the quote total: shipping and Brandora's service line
 * depend on a destination and a sourcing run that have not happened yet. Calling
 * this "estimated" in the type is a small thing that stops it being rendered as
 * a final price by mistake.
 */
export function packageTotals(
  pkg: BrandPackage,
  products: readonly BrandoraProduct[],
): PackageTotals {
  let productsTotal = zero(pkg.currency);
  let customizationTotal = zero(pkg.currency);
  let unitCount = 0;

  for (const item of pkg.items) {
    productsTotal = add(productsTotal, multiply(item.unitPrice, item.quantity));
    unitCount += item.quantity;

    if (!item.customizationMethod) continue;
    const product = products.find((p) => p.id === item.productId);
    const customization = product?.customization;
    if (!customization) continue;

    const perUnit = customization.unitCost ?? money(0, pkg.currency);
    const setup = customization.setupCost ?? money(0, pkg.currency);
    customizationTotal = add(customizationTotal, add(multiply(perUnit, item.quantity), setup));
  }

  return {
    productsTotal,
    customizationTotal,
    estimatedTotal: add(productsTotal, customizationTotal),
    unitCount,
    lineCount: pkg.items.length,
  };
}

/* --- Starter packages ---------------------------------------------------- */

/**
 * Recommended opening kits (§21).
 *
 * Each is a real first order — enough to look like a brand, small enough that a
 * founder can pay for it. The quantities are chosen so every line clears its own
 * minimum, so "add the starter package" never produces a silently adjusted
 * basket.
 */
export interface StarterPackage {
  key: string;
  label: string;
  /** Which businesses it suits, matched loosely against the brand's industry. */
  industries: string[];
  rationale: string;
  items: { productId: string; quantity: number; method?: CustomizationMethod }[];
}

export const STARTER_PACKAGES: readonly StarterPackage[] = [
  {
    key: "bakery",
    label: "Bakery starter",
    industries: ["bakery", "food", "pastry", "cookies", "catering", "restaurant"],
    rationale:
      "Everything a customer touches on their first order: the cup, the bag it leaves in, the sticker that seals it and the card that asks them back.",
    items: [
      { productId: "prd_cup_kraft_250", quantity: 30, method: "logo-print" },
      { productId: "prd_bag_paper_handle", quantity: 20, method: "logo-print" },
      { productId: "prd_sticker_circle_50", quantity: 50, method: "sticker" },
      { productId: "prd_card_thankyou", quantity: 50, method: "logo-print" },
    ],
  },
  {
    key: "beauty",
    label: "Beauty & skincare starter",
    industries: ["beauty", "skincare", "cosmetics", "soap", "hair"],
    rationale:
      "Labels do the heavy lifting in beauty — the bottle is generic until your label is on it.",
    items: [
      { productId: "prd_bottle_glass_500", quantity: 24, method: "sticker" },
      { productId: "prd_label_roll", quantity: 100, method: "sticker" },
      { productId: "prd_box_mailer_small", quantity: 20, method: "logo-print" },
      { productId: "prd_card_thankyou", quantity: 50, method: "logo-print" },
    ],
  },
  {
    key: "retail",
    label: "Retail & fashion starter",
    industries: ["fashion", "retail", "clothing", "tailoring", "accessories"],
    rationale: "The bag and the card are the packaging; the tote is the advertising.",
    items: [
      { productId: "prd_bag_paper_handle", quantity: 20, method: "logo-print" },
      { productId: "prd_tote_canvas", quantity: 20, method: "logo-print" },
      { productId: "prd_card_business_350", quantity: 100, method: "logo-print" },
      { productId: "prd_sticker_circle_50", quantity: 50, method: "sticker" },
    ],
  },
  {
    key: "cafe",
    label: "Café & restaurant starter",
    industries: ["cafe", "coffee", "restaurant", "juice", "bar"],
    rationale: "A branded cup on a table is the cheapest advertising a café will ever buy.",
    items: [
      { productId: "prd_cup_matte_black_350", quantity: 30, method: "logo-print" },
      { productId: "prd_menu_a4", quantity: 10, method: "logo-print" },
      { productId: "prd_apron_canvas", quantity: 10, method: "embroidery" },
      { productId: "prd_sticker_circle_50", quantity: 50, method: "sticker" },
    ],
  },
];

/** Loose industry match, falling back to the bakery kit — the broadest one. */
export function recommendStarter(industry: string): StarterPackage {
  const needle = industry.toLowerCase();
  const found = STARTER_PACKAGES.find((starter) =>
    starter.industries.some((tag) => needle.includes(tag)),
  );
  const fallback = STARTER_PACKAGES[0];
  if (!fallback) throw new Error("no starter packages defined");
  return found ?? fallback;
}

/** Materialise a starter kit into a real package the customer can then edit. */
export function buildStarterPackage(
  brandId: string,
  starter: StarterPackage,
  products: readonly BrandoraProduct[],
  currency: CurrencyCode = DEFAULT_CURRENCY,
  now: Date = new Date(),
): BrandPackage {
  let pkg = createPackage(brandId, starter.label, currency, now);
  for (const line of starter.items) {
    const product = products.find((p) => p.id === line.productId);
    if (!product) continue;
    pkg = addItem(pkg, product, line.quantity, line.method, now).package;
  }
  return pkg;
}
