/**
 * English — the source catalogue.
 *
 * Every other locale is typed against this object, so a missing French key is a
 * build failure rather than an English word appearing in a French checkout.
 */
export const en = {
  /* Navigation */
  "nav.home": "Home",
  "nav.create": "Create my brand",
  "nav.catalog": "Catalogue",
  "nav.package": "My package",
  "nav.visualizer": "Visualizer",
  "nav.quote": "Quote",
  "nav.orders": "Orders",
  "nav.trends": "Trends",
  "nav.assistant": "Ask Brandora",
  "nav.settings": "Settings",
  "nav.dashboard": "Dashboard",
  "nav.login": "Log in",
  "nav.signup": "Sign up",
  "nav.logout": "Log out",

  /* Landing */
  "hero.headline": "Build your brand. Put it everywhere.",
  "hero.subheadline":
    "Brandora helps you turn an idea into a complete brand — from strategy and identity to packaging, sourcing and physical products.",
  "hero.cta.primary": "Create My Brand",
  "hero.cta.secondary": "Explore Brandora",
  "hero.cta.ai": "Ask Brandora",
  "hero.positioning": "From idea to identity to physical brand.",

  "how.title": "How it works",
  "how.01": "Tell us your idea",
  "how.02": "Build your identity",
  "how.03": "Choose your products",
  "how.04": "Visualize your brand",
  "how.05": "Get your quote",
  "how.06": "Order",

  "section.brand.title": "Brand creation",
  "section.brand.body": "Idea becomes identity. Identity becomes a logo you own.",
  "section.physical.title": "Physical branding",
  "section.physical.body": "Your logo on cups, boxes, bags, stickers and cards.",
  "section.sourcing.title": "AI sourcing",
  "section.sourcing.body":
    "Tell Brandora what you need. It searches suppliers, compares the options and returns a quote.",
  "section.visualizer.title": "Visualizer",
  "section.visualizer.body": "See your brand on real products before you spend anything.",
  "section.africa.title": "Built for how small businesses actually start",
  "section.africa.body":
    "Small quantities, flexible sourcing, local delivery, mobile-first, and payment options that work where you are.",
  "cta.final": "Your idea deserves a brand.",

  /* Brand builder */
  "builder.title": "Let's build your brand.",
  "builder.step.interview": "Interview",
  "builder.step.strategy": "Strategy",
  "builder.step.identity": "Identity",
  "builder.step.logo": "Logo",
  "builder.dontknow": "I don't know — help me",
  "builder.next": "Continue",
  "builder.back": "Back",
  "builder.regenerate": "Regenerate",
  "builder.save": "Save my brand",
  "builder.generating": "Building your brand…",

  "brand.name": "Brand name",
  "brand.description": "Description",
  "brand.positioning": "Positioning",
  "brand.target": "Target customer",
  "brand.personality": "Personality",
  "brand.promise": "Promise",
  "brand.mission": "Mission",
  "brand.vision": "Vision",
  "brand.slogan": "Slogan",
  "brand.tone": "Tone of voice",
  "brand.story": "Brand story",
  "brand.palette": "Colour palette",
  "brand.typography": "Typography",
  "brand.logoBrief": "Logo direction",
  "brand.kit.download": "Download Brand Kit",

  /* Catalogue */
  "catalog.title": "Catalogue",
  "catalog.category.packaging": "Packaging",
  "catalog.category.brand-materials": "Brand materials",
  "catalog.category.tableware": "Tableware",
  "catalog.category.merchandise": "Merchandise",
  "catalog.moq": "From {min} units",
  "catalog.customizable": "Customisation available",
  "catalog.customization.unknown": "Customisation not confirmed",
  "catalog.add": "Add to Brand Package",
  "catalog.empty": "Nothing here yet.",

  /* Sourcing results */
  "sourcing.best": "Best Match",
  "sourcing.cheapest": "Lowest Cost",
  "sourcing.fastest": "Fastest Option",
  "sourcing.score": "Brandora Score",
  "sourcing.quantity.ok": "Quantity: compatible",
  "sourcing.quantity.no": "Quantity: not available at this size",
  "sourcing.shipping.ok": "Shipping: available",
  "sourcing.delivery.unavailable": "Delivery estimate unavailable",
  "sourcing.stale": "Prices last confirmed {when}",

  /* Package + quote */
  "package.title": "Brand package",
  "package.add": "Add product",
  "package.remove": "Remove",
  "package.quantity": "Quantity",
  "package.total": "Estimated total",
  "package.empty": "Your package is empty. Add a product to begin.",

  "quote.title": "Brandora quote",
  "quote.reference": "Reference",
  "quote.products": "Product costs",
  "quote.customization": "Customisation",
  "quote.shipping": "Shipping",
  "quote.logistics": "Logistics",
  "quote.service": "Brandora service",
  "quote.total": "Total",
  "quote.validUntil": "Valid until {date}",
  "quote.approve": "Approve quote",
  "quote.modify": "Modify",

  /* Checkout + orders */
  "checkout.title": "Checkout",
  "checkout.name": "Full name",
  "checkout.email": "Email",
  "checkout.phone": "Phone",
  "checkout.whatsapp": "WhatsApp",
  "checkout.address": "Delivery address",
  "checkout.city": "City",
  "checkout.country": "Country",
  "checkout.instructions": "Delivery instructions",
  "checkout.terms": "I accept the terms",
  "checkout.submit": "Place order",

  "order.status.quote": "Quote",
  "order.status.pending-approval": "Pending approval",
  "order.status.confirmed": "Confirmed",
  "order.status.supplier-processing": "Supplier processing",
  "order.status.shipped": "Shipped",
  "order.status.in-transit": "In transit",
  "order.status.delivered": "Delivered",
  "order.status.cancelled": "Cancelled",
  "order.tracking": "Tracking number",
  "order.carrier": "Carrier",

  /* Notifications */
  "notify.quote.ready": "Your quote is ready.",
  "notify.order.confirmed": "Your supplier order has been confirmed.",
  "notify.order.shipped": "Your package has shipped.",
  "notify.order.delivered": "Your order has been delivered.",

  /* Settings */
  "settings.title": "Settings",
  "settings.language": "Language",
  "settings.currency": "Currency",
  "settings.theme": "Appearance",
  "settings.theme.dark": "Dark",
  "settings.theme.light": "Light",
  "settings.country": "Country",
  "settings.save": "Save changes",
  "settings.saved": "Saved",

  /* Errors — mirrors CUSTOMER_MESSAGES in @brandora/shared */
  "error.sourcing.unavailable":
    "We couldn't retrieve this product right now. Please try another option.",
  "error.sourcing.no-results":
    "We couldn't find a match for that yet. Try a different quantity or style.",
  "error.freight.unavailable": "Delivery estimate unavailable",
  "error.brand.generation-failed":
    "We couldn't finish your brand just now. Your answers are saved — try again.",
  "error.quote.expired": "This quote has expired. We can prepare a fresh one for you.",
  "error.order.not-found": "We couldn't find that order.",
  "error.auth.required": "Please sign in to continue.",
  "error.auth.weak-password": "Please choose a longer password — at least 10 characters.",
  "error.auth.forbidden": "You don't have access to this.",
  "error.input.invalid": "Something in that form didn't look right. Please check and try again.",
  "error.rate.limited": "That's a lot of requests. Please wait a moment and try again.",
  "error.internal": "Something went wrong on our side. We're on it.",
} as const;

export type MessageKey = keyof typeof en;
export type Catalogue = Record<MessageKey, string>;
