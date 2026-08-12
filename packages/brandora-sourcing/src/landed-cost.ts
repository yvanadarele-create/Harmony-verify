/**
 * Landed cost and customer price (§39).
 *
 *   supplier cost + customisation + international shipping + logistics + margin
 *   = customer price
 *
 * The important line in §39 is the last one: *the supplier's private cost
 * structure must not be exposed to the customer.* So this module produces two
 * objects rather than one. `LandedCost` is the internal view — every input, the
 * rates applied, the arithmetic. `CustomerBreakdown` is what a quote may show,
 * and it is built by *construction*, not by deleting fields from the internal
 * one. A redaction someone forgets to apply is a leak; a separate type that
 * never held the number cannot leak it.
 *
 * The margin is folded into the customer's product line rather than itemised as
 * "Brandora's cut". That is not concealment — the service line is right there in
 * the quote — it is that a customer buying thirty cups is buying cups, and a
 * quote that reads like an invoice from a middleman invites a founder to go
 * around it, which is exactly the outcome §67 is designed to avoid.
 */

import {
  type Customization,
  type Money,
  type SupplierOffer,
  type BrandoraShippingOption,
  add,
  money,
  multiply,
  roundUpTo,
  zero,
} from "@brandora/shared";

export interface LandedCostInput {
  offer: SupplierOffer;
  quantity: number;
  shipping?: BrandoraShippingOption;
  /** Which customisation the customer chose, if any. */
  customization?: Customization;
  /** From @brandora/config. 0.35 = 35% on landed cost. */
  marginRate: number;
  /** Local handling, storage, last mile, as a rate on goods. */
  logisticsRate: number;
  /** Round the final figure up to a tidy number. 0 disables. */
  roundingStep?: number;
}

/** INTERNAL ONLY. Never serialise this toward a browser. */
export interface LandedCost {
  quantity: number;
  supplierUnitCost: Money;
  supplierTotal: Money;
  customizationTotal: Money;
  shippingTotal: Money;
  logisticsTotal: Money;
  /** Everything before margin — what this order actually costs Brandora. */
  landedTotal: Money;
  marginTotal: Money;
  customerTotal: Money;
  customerUnitPrice: Money;
  marginRate: number;
  logisticsRate: number;
  /** Line-by-line arithmetic, for an admin reconstructing a disputed quote. */
  breakdown: string[];
}

/** What a customer may see. Contains no supplier cost, by construction. */
export interface CustomerBreakdown {
  quantity: number;
  unitPrice: Money;
  productsTotal: Money;
  customizationTotal: Money;
  shippingTotal: Money;
  logisticsTotal: Money;
  serviceTotal: Money;
  total: Money;
}

export function calculateLandedCost(input: LandedCostInput): LandedCost {
  const { offer, quantity, shipping, customization, marginRate, logisticsRate } = input;
  const currency = offer.unitCost.currency;

  const supplierTotal = multiply(offer.unitCost, quantity);

  const customizationTotal = customization
    ? add(
        multiply(customization.unitCost ?? money(0, currency), quantity),
        customization.setupCost ?? money(0, currency),
      )
    : zero(currency);

  const shippingTotal = shipping?.cost ?? zero(currency);

  // Logistics is charged on goods and customisation, not on freight — charging a
  // handling percentage on top of a carrier's own fee is double-dipping, and a
  // founder who compares two quotes will spot it.
  const goods = add(supplierTotal, customizationTotal);
  const logisticsTotal = multiply(goods, logisticsRate);

  const landedTotal = add(add(goods, shippingTotal), logisticsTotal);
  const marginTotal = multiply(landedTotal, marginRate);

  const rawCustomerTotal = add(landedTotal, marginTotal);
  const customerTotal = roundUpTo(rawCustomerTotal, input.roundingStep ?? 0);

  // Rounding lands on the product line, so the shipping and service lines a
  // customer can check against a carrier's own price stay exact.
  const customerUnitPrice = money(
    quantity > 0 ? Math.ceil(customerTotal.amount / quantity) : 0,
    currency,
  );

  return {
    quantity,
    supplierUnitCost: offer.unitCost,
    supplierTotal,
    customizationTotal,
    shippingTotal,
    logisticsTotal,
    landedTotal,
    marginTotal,
    customerTotal,
    customerUnitPrice,
    marginRate,
    logisticsRate,
    breakdown: [
      `supplier ${offer.unitCost.amount} × ${quantity} = ${supplierTotal.amount}`,
      `customisation = ${customizationTotal.amount}`,
      `shipping = ${shippingTotal.amount}`,
      `logistics ${logisticsRate} × ${goods.amount} = ${logisticsTotal.amount}`,
      `landed = ${landedTotal.amount}`,
      `margin ${marginRate} × ${landedTotal.amount} = ${marginTotal.amount}`,
      `customer total = ${customerTotal.amount}${customerTotal.amount !== rawCustomerTotal.amount ? ` (rounded up from ${rawCustomerTotal.amount})` : ""}`,
    ],
  };
}

/**
 * Project the internal cost onto what a customer may see.
 *
 * Margin is distributed across the product line rather than shown separately,
 * and the *service* line is a stated percentage of the visible subtotal — a real
 * charge for coordination, sampling and quality checks, not the supplier delta.
 */
export function toCustomerBreakdown(cost: LandedCost, serviceRate = 0.1): CustomerBreakdown {
  const currency = cost.customerTotal.currency;

  const passThrough =
    cost.shippingTotal.amount + cost.logisticsTotal.amount + cost.customizationTotal.amount;

  const provisionalService = multiply(cost.customerTotal, serviceRate / (1 + serviceRate)).amount;

  // The lines must add up to the total the customer is asked to pay. A quote
  // whose parts do not sum to its own total is the first thing a careful buyer
  // notices, so the product line takes whatever is left and the service line
  // absorbs the shortfall in the pathological case where freight alone exceeds
  // the price — rather than clamping a line and leaving the sum wrong.
  const productsTotal = Math.max(0, cost.customerTotal.amount - provisionalService - passThrough);
  const serviceTotal = cost.customerTotal.amount - passThrough - productsTotal;

  return {
    quantity: cost.quantity,
    unitPrice: money(cost.quantity > 0 ? Math.round(productsTotal / cost.quantity) : 0, currency),
    productsTotal: money(productsTotal, currency),
    customizationTotal: cost.customizationTotal,
    shippingTotal: cost.shippingTotal,
    logisticsTotal: cost.logisticsTotal,
    serviceTotal: money(serviceTotal, currency),
    total: cost.customerTotal,
  };
}
