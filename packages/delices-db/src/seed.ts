/**
 * Seeding.
 *
 * `seedBaseline` sets up what the business cannot start without: the three opening
 * categories and the choice lists behind the custom-cake brief. It is idempotent, so
 * it can run on every boot.
 *
 * `seedDemoCatalogue` is separate and never automatic. It writes example products so
 * a fresh install can be shown to someone; Grace renames, reprices or deletes them.
 * There is deliberately no testimonial seed — those are hers to write.
 */
import type { OptionKind } from "@delices/core";
import { createCategory, createOption, createProduct, getCategoryBySlug, listGlobalOptions } from "./catalogue.js";
import { countUsers, createUser } from "./users.js";
import { DEFAULT_SETTINGS, getAllSettings, setSettings } from "./settings.js";
import type { Db } from "./db.js";

const CATEGORIES: ReadonlyArray<{
  slug: string;
  name: string;
  description: string;
  kind: "standard" | "custom" | "both";
  sortOrder: number;
}> = [
  {
    slug: "gateaux",
    name: "Gâteaux",
    description:
      "Gâteaux de mariage, d'anniversaire et de célébration — à commander tels quels ou à imaginer ensemble.",
    kind: "both",
    sortOrder: 1,
  },
  {
    slug: "pizzas",
    name: "Pizzas",
    description: "Pizzas maison, pâte préparée le jour même.",
    kind: "standard",
    sortOrder: 2,
  },
  {
    slug: "quiches",
    name: "Quiches",
    description: "Quiches et tartes salées, garnies de produits frais.",
    kind: "standard",
    sortOrder: 3,
  },
];

/** Starter choice lists for the brief. Grace adds to them; nothing here is fixed. */
const GLOBAL_OPTIONS: ReadonlyArray<{ kind: OptionKind; group: string; labels: readonly string[] }> = [
  {
    kind: "occasion",
    group: "Occasion",
    labels: [
      "Mariage",
      "Anniversaire",
      "Anniversaire de mariage",
      "Fiançailles",
      "Baptême",
      "Baby shower",
      "Événement professionnel",
      "Autre",
    ],
  },
  {
    kind: "shape",
    group: "Forme",
    labels: ["Rond", "Carré", "Cœur", "Plusieurs étages", "Autre"],
  },
  {
    kind: "flavour",
    group: "Parfum",
    labels: ["Vanille", "Chocolat", "Citron", "Fraise", "Red velvet", "Caramel", "Pistache", "Coco"],
  },
  {
    kind: "filling",
    group: "Garniture",
    labels: [
      "Ganache chocolat",
      "Crème vanille",
      "Confiture de fraises",
      "Caramel beurre salé",
      "Crème citron",
      "Mousse de fruits rouges",
    ],
  },
  {
    kind: "decoration",
    group: "Décoration",
    labels: [
      "Fleurs fraîches",
      "Fleurs en sucre",
      "Coulée de chocolat",
      "Perles et touches dorées",
      "Motifs personnalisés",
      "Photo comestible",
      "Sobre et élégant",
    ],
  },
];

export function seedBaseline(db: Db): void {
  const existing = getAllSettings(db);
  const missing: Record<string, string> = {};
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (existing[key] === undefined) missing[key] = value;
  }
  // Only write the keys that have never been set — never overwrite what Grace typed.
  const stored = db.prepare("SELECT key FROM settings").all() as Array<{ key: string }>;
  const storedKeys = new Set(stored.map((row) => row.key));
  const toWrite: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...DEFAULT_SETTINGS, ...missing })) {
    if (!storedKeys.has(key)) toWrite[key] = value;
  }
  if (Object.keys(toWrite).length > 0) setSettings(db, toWrite);

  for (const category of CATEGORIES) {
    if (!getCategoryBySlug(db, category.slug)) {
      createCategory(db, {
        slug: category.slug,
        name: category.name,
        description: category.description,
        kind: category.kind,
        sortOrder: category.sortOrder,
        active: true,
      });
    }
  }

  const present = listGlobalOptions(db);
  for (const group of GLOBAL_OPTIONS) {
    group.labels.forEach((label, index) => {
      const already = present.some((option) => option.kind === group.kind && option.label === label);
      if (already) return;
      createOption(db, {
        productId: null,
        kind: group.kind,
        groupLabel: group.group,
        label,
        sortOrder: index,
        active: true,
      });
    });
  }
}

/** Creates the first owner account when the database has no users at all. */
export function seedOwner(
  db: Db,
  input: { name: string; email: string; password: string },
): { created: boolean } {
  if (countUsers(db) > 0) return { created: false };
  createUser(db, { ...input, role: "owner" });
  return { created: true };
}

/**
 * Example products, on request only. Prices are placeholders in the configured
 * currency's minor unit — the point is to show the shape of a catalogue entry, not
 * to state what Grace charges.
 */
export function seedDemoCatalogue(db: Db): void {
  const gateaux = getCategoryBySlug(db, "gateaux");
  const pizzas = getCategoryBySlug(db, "pizzas");
  const quiches = getCategoryBySlug(db, "quiches");
  if (!gateaux || !pizzas || !quiches) throw new Error("seedBaseline must run first");

  const cake = createProduct(db, {
    categoryId: gateaux.id,
    name: "Gâteau d'anniversaire personnalisé",
    description:
      "Génoise moelleuse, garniture au choix et décor à votre image. Exemple de fiche produit — à adapter.",
    basePrice: 4500,
    priceFrom: true,
    servings: 12,
    customisable: true,
    featured: true,
    sortOrder: 1,
  });
  [
    { label: "12 parts", delta: 0, servings: 12 },
    { label: "20 parts", delta: 2500, servings: 20 },
    { label: "30 parts", delta: 5500, servings: 30 },
  ].forEach((size, index) =>
    createOption(db, {
      productId: cake.id,
      kind: "size",
      groupLabel: "Taille",
      label: size.label,
      priceDelta: size.delta,
      servings: size.servings,
      required: true,
      sortOrder: index,
    }),
  );
  ["Vanille", "Chocolat", "Red velvet"].forEach((label, index) =>
    createOption(db, {
      productId: cake.id,
      kind: "flavour",
      groupLabel: "Parfum",
      label,
      required: true,
      sortOrder: index,
    }),
  );

  createProduct(db, {
    categoryId: gateaux.id,
    name: "Wedding cake sur mesure",
    description:
      "Plusieurs étages, décor floral et finitions à la main. Tarif établi après échange — exemple de fiche produit.",
    basePrice: null,
    customisable: true,
    featured: true,
    sortOrder: 2,
  });

  const margherita = createProduct(db, {
    categoryId: pizzas.id,
    name: "Pizza Margherita",
    description: "Sauce tomate maison, mozzarella, basilic frais. Exemple de fiche produit.",
    ingredients: "Pâte maison, sauce tomate, mozzarella, basilic, huile d'olive",
    basePrice: 1000,
    featured: true,
    sortOrder: 1,
  });
  [
    { label: "Moyenne (26 cm)", delta: 0 },
    { label: "Grande (33 cm)", delta: 400 },
  ].forEach((size, index) =>
    createOption(db, {
      productId: margherita.id,
      kind: "size",
      groupLabel: "Taille",
      label: size.label,
      priceDelta: size.delta,
      required: true,
      sortOrder: index,
    }),
  );

  const quiche = createProduct(db, {
    categoryId: quiches.id,
    name: "Quiche lorraine",
    description: "Pâte brisée maison, lardons, crème et œufs fermiers. Exemple de fiche produit.",
    ingredients: "Pâte brisée, lardons, crème fraîche, œufs, muscade",
    basePrice: 1400,
    servings: 6,
    featured: true,
    sortOrder: 1,
  });
  [
    { label: "6 parts", delta: 0, servings: 6 },
    { label: "10 parts", delta: 800, servings: 10 },
  ].forEach((size, index) =>
    createOption(db, {
      productId: quiche.id,
      kind: "size",
      groupLabel: "Taille",
      label: size.label,
      priceDelta: size.delta,
      servings: size.servings,
      required: true,
      sortOrder: index,
    }),
  );
}
