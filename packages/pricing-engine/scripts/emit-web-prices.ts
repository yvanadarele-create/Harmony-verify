/**
 * Generates the price table the public pricing simulator runs on.
 *
 * The simulator has to be instant and work on a static site with no backend, which
 * means the numbers have to be in the browser. But the punch list is explicit that
 * `expert_payout` and `EXPERT_SHARE` must not appear on the pricing page — they are
 * internal margin logic, and shipping the engine itself would publish them to
 * anyone who opens the network tab.
 *
 * So this emits *results*, not the engine: the finished customer price for every
 * combination of the four discrete inputs (6 specialties × 3 complexities ×
 * 3 risk levels × 2 review modes = 108 entries, a few kilobytes). Volume discount
 * and quantity are applied in the browser because they are arithmetic a customer
 * can already see on their invoice.
 *
 * Because it is generated from the real engine at build time, the page can never
 * quote a price the platform would not charge — the usual failure mode where a
 * marketing calculator and the billing system drift apart is structurally absent.
 *
 * Run: pnpm --filter @harmony/pricing-engine build
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BATCH_DISCOUNT,
  COMPLIANCE_MULT,
  LATENCY_MULT,
  MODEL_MULT,
  MONITORING_BASE_CENTS,
  MONITORING_RISK_MULT,
  PER_REQUEST_CENTS,
  customerPrice,
  slaHours,
} from "../src/index.ts";
import type { Complexity, RiskLevel, Specialty } from "@harmony/shared";

const SPECIALTIES: Specialty[] = [
  "general-medicine",
  "cardiology",
  "oncology",
  "neurology",
  "radiology",
  "other",
];
const COMPLEXITIES: Complexity[] = ["low", "medium", "high"];
const RISKS: RiskLevel[] = ["low", "medium", "high"];
const MODES = ["single", "double"] as const;

interface Entry {
  price: number;
  sla: number;
}

const table: Record<string, Entry> = {};

for (const specialty of SPECIALTIES) {
  for (const complexity of COMPLEXITIES) {
    for (const risk of RISKS) {
      for (const reviewMode of MODES) {
        const result = customerPrice({ specialty, complexity, risk, reviewMode });
        // unitPriceCents only. `result.payout` and `result.marginCents` are read
        // here and deliberately dropped — they must not cross into the browser.
        table[`${specialty}|${complexity}|${risk}|${reviewMode}`] = {
          price: result.unitPriceCents,
          sla: slaHours(complexity, risk, reviewMode),
        };
      }
    }
  }
}

const payload = {
  generated: "packages/pricing-engine/scripts/emit-web-prices.ts",
  currency: "USD",
  batchDiscount: BATCH_DISCOUNT,
  perReview: table,
  monitoring: {
    baseCents: MONITORING_BASE_CENTS,
    perRequestCents: PER_REQUEST_CENTS,
    risk: MONITORING_RISK_MULT,
    compliance: COMPLIANCE_MULT,
    model: MODEL_MULT,
    latency: LATENCY_MULT,
  },
};

const serialised = JSON.stringify(payload, null, 2);

// Checked before the file is written, so a future change that widens the payload
// fails the build rather than quietly publishing internal economics.
const FORBIDDEN = ["payout", "EXPERT_SHARE", "expertShare", "margin", "TIER_BASE", "SPECIALTY_MULT"];
const found = FORBIDDEN.filter((needle) => serialised.includes(needle));
if (found.length > 0) {
  throw new Error(
    `Refusing to emit: the browser price table would contain internal pricing terms (${found.join(", ")}).`,
  );
}

const banner = `/* Generated from packages/pricing-engine — do not edit by hand.
 *
 * Finished customer prices only. What an expert is paid, the revenue share and
 * the tier base rates are internal and are not emitted here by design.
 */`;

const out = `${banner}
window.HarmonyPrices = ${serialised};
`;

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "../../../apps/web/assets/js/price-table.js");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, out, "utf8");

console.log(
  `price-table.js: ${Object.keys(table).length} per-review prices + monitoring rates → apps/web/assets/js/price-table.js`,
);
