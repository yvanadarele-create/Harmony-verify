/**
 * Domain types for Les Délices de Grace Lumière.
 *
 * Two ideas drive the whole model and are worth stating once:
 *
 *  1. A pizza and a wedding cake are not the same transaction. A `standard` order is
 *     a priced basket; a `custom` order is a request that carries a brief and has no
 *     price until Grace sets one. Both are the same `orders` row so that one queue,
 *     one calendar and one customer history cover the business — the `kind` field and
 *     the optional `custom_request` decide how much ceremony the customer sees.
 *
 *  2. Nothing about the catalogue is hard-coded. Categories are rows, so "desserts",
 *     "pâtisseries", "traiteur" or "plateaux salés" are additions in the admin, not
 *     code changes.
 */

/** Money is stored in the currency's minor unit (cents for EUR, whole units for XAF). */
export type Minor = number;

export type OrderKind = "standard" | "custom";
export type Fulfillment = "pickup" | "delivery";

/**
 * The lifecycle of an order. Statuses are the specified set; the transitions between
 * them live in `order-status.ts`.
 */
export type OrderStatus =
  | "NEW"
  | "REVIEWING"
  | "QUOTE_SENT"
  | "CONFIRMED"
  | "DEPOSIT_PAID"
  | "IN_PRODUCTION"
  | "READY"
  | "OUT_FOR_DELIVERY"
  | "COMPLETED"
  | "CANCELLED";

/** Payment is recorded, not processed — V1 has no online payment provider. */
export type PaymentStatus = "PENDING" | "DEPOSIT_PAID" | "PARTIALLY_PAID" | "PAID" | "REFUNDED";

export type AppointmentStatus = "NEW" | "SCHEDULED" | "DONE" | "CANCELLED";

/**
 * How a category behaves in the shop:
 *  - `standard`: pick options, add to basket (pizzas, quiches)
 *  - `custom`:   brief and quote only
 *  - `both`:     a listed cake can be ordered as-is or used as a starting point
 */
export type CategoryKind = "standard" | "custom" | "both";

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  kind: CategoryKind;
  sortOrder: number;
  active: boolean;
}

/**
 * An option belongs to a product, or — when `productId` is null — to the global
 * catalogue that feeds the custom-cake brief (flavours, fillings, decorations,
 * shapes, occasions). One table, because they are the same thing to the admin:
 * a named, ordered, switchable choice.
 */
export type OptionKind =
  | "size"
  | "flavour"
  | "filling"
  | "decoration"
  | "shape"
  | "occasion"
  | "extra";

export interface ProductOption {
  id: string;
  productId: string | null;
  kind: OptionKind;
  groupLabel: string;
  label: string;
  priceDelta: Minor;
  /** Servings this size yields, when the option is a size. */
  servings: number | null;
  required: boolean;
  multiple: boolean;
  sortOrder: number;
  active: boolean;
}

export interface Product {
  id: string;
  categoryId: string;
  categorySlug: string;
  slug: string;
  name: string;
  description: string | null;
  ingredients: string | null;
  /** Null for products that are quoted rather than priced. */
  basePrice: Minor | null;
  /** True when the price is a starting point ("à partir de"). */
  priceFrom: boolean;
  servings: number | null;
  customisable: boolean;
  available: boolean;
  featured: boolean;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  options?: ProductOption[];
  media?: MediaAsset[];
}

export interface MediaAsset {
  id: string;
  filename: string;
  url: string;
  alt: string | null;
  mimeType: string;
  byteSize: number;
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  preferences: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerSummary extends Customer {
  totalOrders: number;
  totalSpend: Minor;
  lastOrderDate: string | null;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string | null;
  /** Copied at order time so history survives a product being renamed or removed. */
  productName: string;
  categoryName: string;
  unitPrice: Minor | null;
  quantity: number;
  selectedOptions: SelectedOption[];
  notes: string | null;
}

export interface SelectedOption {
  groupLabel: string;
  label: string;
  priceDelta: Minor;
}

/** The brief behind a `custom` order. */
export interface CustomRequest {
  id: string;
  orderId: string;
  occasion: string;
  servings: number | null;
  shape: string | null;
  flavour: string | null;
  filling: string | null;
  colours: string | null;
  decoration: string | null;
  messageOnCake: string | null;
  inspirationMediaId: string | null;
  inspirationUrl: string | null;
  requirements: string | null;
}

export interface Order {
  id: string;
  reference: string;
  customerId: string;
  kind: OrderKind;
  status: OrderStatus;
  requestedDate: string;
  fulfillment: Fulfillment;
  address: string | null;
  deliveryNotes: string | null;
  customerNotes: string | null;
  internalNotes: string | null;
  /** Set by Grace when she quotes. Null until then — V1 never auto-prices a brief. */
  quotedTotal: Minor | null;
  /** Sum of the priced basket lines, kept for standard orders. */
  itemsTotal: Minor;
  depositPaid: Minor;
  paymentStatus: PaymentStatus;
  createdAt: string;
  updatedAt: string;
  items?: OrderItem[];
  customRequest?: CustomRequest | null;
  customer?: Customer;
  events?: OrderEvent[];
}

export interface OrderEvent {
  id: string;
  orderId: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  note: string | null;
  createdAt: string;
}

export interface Appointment {
  id: string;
  customerId: string | null;
  name: string;
  phone: string;
  whatsapp: string | null;
  email: string | null;
  preferredDate: string | null;
  preferredTime: string | null;
  reason: string;
  message: string | null;
  status: AppointmentStatus;
  internalNotes: string | null;
  createdAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: string | null;
  quantity: number;
  unit: string;
  minimumStock: number;
  purchasePrice: Minor | null;
  supplierId: string | null;
  supplierName?: string | null;
  updatedAt: string;
}

export interface Testimonial {
  id: string;
  customerName: string;
  body: string;
  photoMediaId: string | null;
  photoUrl: string | null;
  productId: string | null;
  productName?: string | null;
  eventDate: string | null;
  published: boolean;
  sortOrder: number;
  createdAt: string;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: "owner" | "staff";
  createdAt: string;
}

/** Settings are key/value so contact details are never hard-coded in a page. */
export interface PublicSettings {
  businessName: string;
  tagline: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  hours: string;
  instagram: string;
  facebook: string;
  currency: string;
  locale: string;
  /** Minimum notice, in days, shown on the order forms. */
  leadTimeDays: number;
  announcement: string;
}

export interface OrderDraftItem {
  productId: string;
  quantity: number;
  selectedOptionIds: string[];
  notes?: string | null;
}

export interface CustomerDetails {
  name: string;
  phone: string;
  whatsapp?: string | null;
  email?: string | null;
}

export interface OrderDraft {
  customer: CustomerDetails;
  items: OrderDraftItem[];
  requestedDate: string;
  fulfillment: Fulfillment;
  address?: string | null;
  deliveryNotes?: string | null;
  customerNotes?: string | null;
}

export interface CustomRequestDraft {
  customer: CustomerDetails;
  occasion: string;
  requestedDate: string;
  servings?: number | null;
  shape?: string | null;
  flavour?: string | null;
  filling?: string | null;
  colours?: string | null;
  decoration?: string | null;
  messageOnCake?: string | null;
  inspirationMediaId?: string | null;
  requirements?: string | null;
  fulfillment: Fulfillment;
  address?: string | null;
  deliveryNotes?: string | null;
  customerNotes?: string | null;
}

export interface AppointmentDraft {
  name: string;
  phone: string;
  whatsapp?: string | null;
  email?: string | null;
  preferredDate?: string | null;
  preferredTime?: string | null;
  reason: string;
  message?: string | null;
}
