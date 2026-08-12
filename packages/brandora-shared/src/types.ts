/**
 * The Brandora domain vocabulary.
 *
 * These are the *Brandora* types — `BrandoraProduct`, `BrandoraSupplier`,
 * `BrandoraShippingOption`. No supplier's field names appear here, and none ever
 * should. AliExpress is one sourcing provider behind an adapter (spec §26, §76);
 * the day a second supplier is added, nothing above the adapter changes.
 */

import type { CurrencyCode, Money } from "./money.js";

export type Id = string;
export type IsoDateTime = string;

/* --- People and locale --------------------------------------------------- */

export const LOCALES = ["en", "fr", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export const isLocale = (value: string): value is Locale =>
  (LOCALES as readonly string[]).includes(value);

/** Supplier is deliberately declared now: the portal is future work (§62). */
export const USER_ROLES = ["customer", "admin", "supplier"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface User {
  id: Id;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  locale: Locale;
  currency: CurrencyCode;
  country?: string;
  defaultAddressId?: Id;
  createdAt: IsoDateTime;
}

export interface Address {
  id: Id;
  userId: Id;
  recipient: string;
  phone: string;
  whatsapp?: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  country: string;
  postalCode?: string;
  instructions?: string;
}

/* --- Brand --------------------------------------------------------------- */

export const POSITIONINGS = [
  "affordable",
  "accessible-premium",
  "premium",
  "luxury",
  "contemporary",
  "mass-market",
] as const;
export type Positioning = (typeof POSITIONINGS)[number];

export const BRAND_STATUSES = ["draft", "interviewing", "generated", "active", "archived"] as const;
export type BrandStatus = (typeof BRAND_STATUSES)[number];

export interface ColorSwatch {
  name: string;
  /** `#RRGGBB`, uppercase. */
  hex: string;
  role: "primary" | "secondary" | "accent" | "surface" | "ink";
  /** Why this colour is here, in words the founder can repeat to a printer. */
  rationale: string;
}

export interface Typography {
  primary: string;
  secondary: string;
  primaryFallback: string;
  secondaryFallback: string;
  rationale: string;
}

/**
 * The generated brand. One row per brand, and a user may own several (§59).
 *
 * Everything an AI turn needs to stop being generic lives here — this object is
 * the assistant's memory (§22).
 */
export interface BrandProfile {
  id: Id;
  userId: Id;
  name: string;
  description: string;
  industry: string;
  targetCustomer: string;
  positioning: Positioning;
  personality: string[];
  promise: string;
  mission: string;
  vision: string;
  slogan: string;
  toneOfVoice: string;
  brandStory: string;
  palette: ColorSwatch[];
  typography: Typography;
  /** The creative brief a designer or an image model works from (§18). */
  logoBrief: string;
  logoAssetId?: Id;
  status: BrandStatus;
  locale: Locale;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export const ASSET_KINDS = [
  "logo-primary",
  "logo-symbol",
  "logo-wordmark",
  "logo-monochrome",
  "mockup",
  "packaging",
  "guidelines",
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export interface BrandAsset {
  id: Id;
  brandId: Id;
  kind: AssetKind;
  url: string;
  /** The prompt or brief that produced it — regeneration needs provenance. */
  sourceBrief?: string;
  createdAt: IsoDateTime;
}

/* --- Products ------------------------------------------------------------ */

export const PRODUCT_CATEGORIES = [
  "packaging",
  "brand-materials",
  "tableware",
  "merchandise",
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const PRODUCT_STATUSES = ["draft", "active", "disabled"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const CUSTOMIZATION_METHODS = [
  "logo-print",
  "engraving",
  "sticker",
  "sublimation",
  "embroidery",
  "other",
] as const;
export type CustomizationMethod = (typeof CUSTOMIZATION_METHODS)[number];

/**
 * How confident Brandora is that a product can carry a logo.
 *
 * This exists because §36 forbids claiming a product is customisable on a guess.
 * `unknown` is a real, displayable state — the interface says "not confirmed"
 * rather than quietly implying yes.
 */
export const CUSTOMIZATION_CONFIDENCE = ["verified", "reported", "unknown", "unavailable"] as const;
export type CustomizationConfidence = (typeof CUSTOMIZATION_CONFIDENCE)[number];

export interface Customization {
  confidence: CustomizationConfidence;
  methods: CustomizationMethod[];
  /** Per-unit, in the catalogue currency. Absent when it is not yet known. */
  unitCost?: Money;
  setupCost?: Money;
  minimumUnits?: number;
  notes?: string;
}

export interface Dimensions {
  lengthMm?: number;
  widthMm?: number;
  heightMm?: number;
  weightG?: number;
  volumeMl?: number;
}

export interface BrandoraVariant {
  id: Id;
  productId: Id;
  label: string;
  color?: string;
  size?: string;
  material?: string;
  unitPrice: Money;
  availableQuantity: number;
}

/** The catalogue product a customer sees. Never a supplier's row. */
export interface BrandoraProduct {
  id: Id;
  name: string;
  category: ProductCategory;
  subcategory: string;
  description: string;
  images: string[];
  material?: string;
  dimensions?: Dimensions;
  colors: string[];
  minimumQuantity: number;
  availableQuantity: number;
  /** Indicative shelf price per unit before sourcing runs. */
  indicativeUnitPrice: Money;
  customization: Customization;
  variants: BrandoraVariant[];
  status: ProductStatus;
  featured: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/* --- Suppliers ----------------------------------------------------------- */

export const SUPPLIER_PLATFORMS = ["aliexpress", "alibaba", "local", "direct"] as const;
export type SupplierPlatform = (typeof SUPPLIER_PLATFORMS)[number];

export interface BrandoraSupplier {
  id: Id;
  name: string;
  platform: SupplierPlatform;
  externalId: string;
  /** 0–1. Rating, dispute rate and fulfilment history, normalised. */
  reliability: number;
  status: "active" | "paused";
  notes?: string;
}

/**
 * A supplier's offer for one product.
 *
 * `unitCost` is Brandora's cost, not the customer's price. It is marked here so
 * that anything serialising toward a browser has an obvious thing to strip —
 * §39 requires the cost structure stay private.
 */
export interface SupplierOffer {
  id: Id;
  supplierId: Id;
  supplier: BrandoraSupplier;
  externalProductId: string;
  productUrl?: string;
  title: string;
  images: string[];
  /** PRIVATE. Brandora's landed input, never rendered to a customer. */
  unitCost: Money;
  moq: number;
  availableQuantity: number;
  customization: Customization;
  /** Signals used for scoring: reviews, orders, rating. */
  qualitySignals: QualitySignals;
  /** When this row was last confirmed against the supplier API (§75). */
  lastCheckedAt: IsoDateTime;
}

export interface QualitySignals {
  /** 0–5, as suppliers usually express it. Absent when unpublished. */
  rating?: number;
  reviewCount?: number;
  orderCount?: number;
}

/**
 * A shipping option, normalised.
 *
 * `estimatedDays` is optional *by design*. §38 forbids inventing a delivery
 * date; when the freight API does not return one, this stays undefined and the
 * interface says "Delivery estimate unavailable".
 */
export interface BrandoraShippingOption {
  id: string;
  carrier: string;
  serviceName: string;
  cost: Money;
  estimatedDaysMin?: number;
  estimatedDaysMax?: number;
  trackingAvailable: boolean;
  destinationCountry: string;
}

/* --- Packages, quotes, orders -------------------------------------------- */

export interface PackageItem {
  id: Id;
  productId: Id;
  variantId?: Id;
  name: string;
  quantity: number;
  unitPrice: Money;
  customizationMethod?: CustomizationMethod;
}

export interface BrandPackage {
  id: Id;
  brandId: Id;
  name: string;
  items: PackageItem[];
  currency: CurrencyCode;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export const QUOTE_STATUSES = ["draft", "sent", "approved", "rejected", "expired"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export interface QuoteLine {
  id: Id;
  description: string;
  quantity: number;
  unitPrice: Money;
  total: Money;
}

export interface Quote {
  id: Id;
  brandId: Id;
  packageId: Id;
  reference: string;
  currency: CurrencyCode;
  lines: QuoteLine[];
  productsTotal: Money;
  customizationTotal: Money;
  shippingTotal: Money;
  logisticsTotal: Money;
  serviceTotal: Money;
  total: Money;
  status: QuoteStatus;
  /** Set only when freight returned one. Never inferred. */
  deliveryEstimate?: string;
  validUntil: IsoDateTime;
  createdAt: IsoDateTime;
}

export const ORDER_STATUSES = [
  "quote",
  "pending-approval",
  "confirmed",
  "supplier-processing",
  "shipped",
  "in-transit",
  "delivered",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface Order {
  id: Id;
  quoteId: Id;
  brandId: Id;
  userId: Id;
  addressId: Id;
  status: OrderStatus;
  total: Money;
  supplierOrderId?: string;
  trackingNumber?: string;
  carrier?: string;
  shippingStatus?: string;
  history: OrderEvent[];
  createdAt: IsoDateTime;
  lastUpdate: IsoDateTime;
}

export interface OrderEvent {
  at: IsoDateTime;
  status: OrderStatus;
  note?: string;
  /** Who moved it — `system`, an admin's user id, or a supplier webhook. */
  actor: string;
}
