import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  expertPayout,
  customerPrice,
  monitoringPrice,
  datasetPrice,
  blendedPayoutCents,
  inferSeniority,
  juniorEligible,
  slaHours,
  MIN_SLA_HOURS,
  PAYOUT_FLOOR_CENTS,
  PAYOUT_CEILING_CENTS,
  PRICE_FLOOR_CENTS,
  EXPERT_SHARE,
} from "@harmony/pricing-engine";
import type { Complexity, RiskLevel, Specialty } from "@harmony/shared";

/* --- 6.1 Expert payout -------------------------------------------------- */

describe("pricing 6.1 — expert payout", () => {
  test("worked example: junior, General Practice, low complexity, Low risk = $3.50", () => {
    const r = expertPayout({ specialty: "general-medicine", complexity: "low", risk: "low" });
    // 5 × 0.7 × 1 × 1 = 3.50
    assert.equal(r.rawCents, 350);
    assert.equal(r.payoutCents, 350, "above the $2 floor, so not clamped");
    assert.equal(r.seniority, "junior");
    assert.equal(r.clamped, null);
  });

  test("worked example: senior, Oncology, high complexity, High risk = $337.50", () => {
    const r = expertPayout({ specialty: "oncology", complexity: "high", risk: "high" });
    // 60 × 1.5 × 2.5 × 1.5 = 337.50
    assert.equal(r.rawCents, 33_750);
    assert.equal(r.payoutCents, 33_750);
    assert.equal(r.seniority, "senior");
    assert.equal(r.clamped, null, "inside the $500 ceiling");
  });

  test("seniority is inferred from complexity and risk", () => {
    assert.equal(inferSeniority("high", "low"), "senior");
    assert.equal(inferSeniority("low", "high"), "senior");
    assert.equal(inferSeniority("medium", "low"), "standard");
    assert.equal(inferSeniority("low", "medium"), "standard");
    assert.equal(inferSeniority("low", "low"), "junior");
  });

  test("junior reviewers are only ever eligible for low-complexity, low-risk cases", () => {
    const levels: Array<[Complexity, RiskLevel]> = [
      ["low", "low"], ["low", "medium"], ["low", "high"],
      ["medium", "low"], ["medium", "medium"], ["medium", "high"],
      ["high", "low"], ["high", "medium"], ["high", "high"],
    ];
    for (const [c, r] of levels) {
      const expected = c === "low" && r === "low";
      assert.equal(juniorEligible(c, r), expected, `${c}/${r}`);
    }
  });

  test("payout never escapes the $2–$500 band, across every combination", () => {
    const specialties: Specialty[] = [
      "general-medicine", "oncology", "cardiology", "radiology", "neurology", "other",
    ];
    for (const specialty of specialties) {
      for (const complexity of ["low", "medium", "high"] as const) {
        for (const risk of ["low", "medium", "high"] as const) {
          const { payoutCents } = expertPayout({ specialty, complexity, risk });
          assert.ok(payoutCents >= PAYOUT_FLOOR_CENTS, `${specialty}/${complexity}/${risk} below floor`);
          assert.ok(payoutCents <= PAYOUT_CEILING_CENTS, `${specialty}/${complexity}/${risk} above ceiling`);
          assert.equal(payoutCents, Math.trunc(payoutCents), "whole cents only");
        }
      }
    }
  });

  test("high-demand specialties pay more than low-demand for identical work", () => {
    const onc = expertPayout({ specialty: "oncology", complexity: "low", risk: "low" }).payoutCents;
    const gp = expertPayout({ specialty: "general-medicine", complexity: "low", risk: "low" }).payoutCents;
    assert.ok(onc > gp);
  });

  test("payout is explained line by line", () => {
    const r = expertPayout({ specialty: "cardiology", complexity: "medium", risk: "medium" });
    assert.ok(r.breakdown.length >= 5);
    assert.ok(r.breakdown.some((l) => l.includes("Tier")));
    assert.ok(r.breakdown.some((l) => l.includes("Complexity")));
  });
});

/* --- 6.2 Customer price ------------------------------------------------- */

describe("pricing 6.2 — customer price", () => {
  test("worked example: Oncology senior high/High ≈ $614", () => {
    const r = customerPrice({ specialty: "oncology", complexity: "high", risk: "high" });
    // 337.50 / 0.55 = 613.63…
    assert.equal(r.priceCents, 61_364);
    assert.ok(Math.abs(r.priceCents / 100 - 614) < 1, "within a dollar of the stated $614");
  });

  test("the expert keeps 55% on a single review", () => {
    const r = customerPrice({ specialty: "cardiology", complexity: "medium", risk: "medium" });
    const share = r.payout.payoutCents / r.priceCents;
    assert.ok(Math.abs(share - EXPERT_SHARE) < 0.01, `expected ~${EXPERT_SHARE}, got ${share.toFixed(3)}`);
  });

  test("price never falls below the $10 floor", () => {
    const r = customerPrice({ specialty: "general-medicine", complexity: "low", risk: "low" });
    // payout $3.50 / 0.55 = $6.36, which the floor lifts to $10
    assert.equal(r.priceCents, PRICE_FLOOR_CENTS);
  });

  test("double review costs 1.8x, not 2x", () => {
    const single = customerPrice({ specialty: "oncology", complexity: "high", risk: "high" });
    const double = customerPrice({ specialty: "oncology", complexity: "high", risk: "high", reviewMode: "double" });
    assert.equal(double.priceCents, Math.round(single.priceCents * 1.8));
    assert.ok(double.priceCents < single.priceCents * 2, "discounted against two full reviews");
  });

  test("batches earn a 10% volume discount", () => {
    const one = customerPrice({ specialty: "cardiology", complexity: "medium", risk: "medium" });
    const ten = customerPrice({ specialty: "cardiology", complexity: "medium", risk: "medium", count: 10 });
    assert.equal(ten.priceCents, Math.round(one.priceCents * 10 * 0.9));
    assert.ok(ten.priceCents < one.priceCents * 10);
  });

  test("margin accounts for paying two experts on a double review", () => {
    const d = customerPrice({ specialty: "oncology", complexity: "high", risk: "high", reviewMode: "double" });
    assert.equal(d.marginCents, d.priceCents - d.payout.payoutCents * 2);
  });

  test("Harmony never sells a review at a loss", () => {
    const specialties: Specialty[] = ["general-medicine", "oncology", "cardiology", "radiology", "neurology", "other"];
    for (const specialty of specialties) {
      for (const complexity of ["low", "medium", "high"] as const) {
        for (const risk of ["low", "medium", "high"] as const) {
          for (const reviewMode of ["single", "double"] as const) {
            const r = customerPrice({ specialty, complexity, risk, reviewMode });
            assert.ok(
              r.marginCents > 0,
              `negative margin: ${specialty}/${complexity}/${risk}/${reviewMode} = ${r.marginCents}`,
            );
          }
        }
      }
    }
  });
});

/* --- 6.3 Continuous monitoring ------------------------------------------ */

describe("pricing 6.3 — continuous monitoring", () => {
  test("base fee applies with zero volume", () => {
    const r = monitoringPrice({ requestsPerDay: 0, risk: "low", compliance: "detection", model: "chatbot", latency: "batch" });
    assert.equal(r.monthlyCents, 50_000);
    assert.equal(r.volumeCents, 0);
  });

  test("formula matches the spec", () => {
    // 1000/day × 30 × $0.01 = $300 base volume; ×5 risk ×3 audit ×1.5 agent ×2 realtime = 45
    const r = monitoringPrice({ requestsPerDay: 1000, risk: "high", compliance: "audit", model: "agent", latency: "realtime" });
    assert.equal(r.volumeCents, Math.round(1000 * 30 * 1 * 5 * 3 * 1.5 * 2));
    assert.equal(r.monthlyCents, 50_000 + r.volumeCents);
  });

  test("every multiplier increases the price monotonically", () => {
    const base = { requestsPerDay: 500, risk: "low", compliance: "detection", model: "chatbot", latency: "batch" } as const;
    const b = monitoringPrice(base).monthlyCents;
    assert.ok(monitoringPrice({ ...base, risk: "high" }).monthlyCents > b);
    assert.ok(monitoringPrice({ ...base, compliance: "audit" }).monthlyCents > b);
    assert.ok(monitoringPrice({ ...base, model: "agent" }).monthlyCents > b);
    assert.ok(monitoringPrice({ ...base, latency: "realtime" }).monthlyCents > b);
  });

  test("negative request counts cannot produce a discount", () => {
    const r = monitoringPrice({ requestsPerDay: -5000, risk: "high", compliance: "audit", model: "agent", latency: "realtime" });
    assert.equal(r.monthlyCents, 50_000, "floors at the base fee");
  });
});

/* --- 6.4 Dataset licensing ---------------------------------------------- */

describe("pricing 6.4 — dataset licensing", () => {
  test("worked example: $40 blended payout, ×2.5 → $100 unit price", () => {
    const r = datasetPrice({ avgExpertPayoutCents: 4_000, tier: "starter" });
    assert.equal(r.unitPriceCents, 10_000);
    assert.equal(r.totalCents, 50 * 10_000, "Starter: 50 × $100 × 1.0 = $5,000");
    assert.equal(r.totalCents / 100, 5_000);
  });

  test("worked example: Enterprise 10,000 × $100 × 0.4 = $400,000", () => {
    const r = datasetPrice({ avgExpertPayoutCents: 4_000, tier: "enterprise" });
    assert.equal(r.totalCents / 100, 400_000);
  });

  test("Growth tier applies the 0.7 curve", () => {
    const r = datasetPrice({ avgExpertPayoutCents: 4_000, tier: "growth" });
    assert.equal(r.totalCents / 100, 500 * 100 * 0.7);
  });

  test("larger packages cost more in total but less per example", () => {
    const s = datasetPrice({ avgExpertPayoutCents: 4_000, tier: "starter" });
    const e = datasetPrice({ avgExpertPayoutCents: 4_000, tier: "enterprise" });
    assert.ok(e.totalCents > s.totalCents);
    assert.ok(e.totalCents / e.examples < s.totalCents / s.examples, "volume must be cheaper per unit");
  });

  test("blended payout sits between the junior and senior payouts", () => {
    const blended = blendedPayoutCents("oncology");
    const junior = expertPayout({ specialty: "oncology", complexity: "medium", risk: "medium", seniority: "junior" }).payoutCents;
    const senior = expertPayout({ specialty: "oncology", complexity: "medium", risk: "medium", seniority: "senior" }).payoutCents;
    assert.ok(blended > junior && blended < senior);
  });

  test("dataset pricing is driven by blended payout, not the $2 floor", () => {
    const fromFloor = datasetPrice({ avgExpertPayoutCents: PAYOUT_FLOOR_CENTS, tier: "starter" }).totalCents;
    const fromBlended = datasetPrice({ avgExpertPayoutCents: blendedPayoutCents("oncology"), tier: "starter" }).totalCents;
    assert.ok(fromBlended > fromFloor * 5, "the floor would badly undervalue the dataset");
  });
});

/* --- SLA ---------------------------------------------------------------- */

describe("pricing — SLA", () => {
  test("higher risk compresses turnaround", () => {
    assert.ok(slaHours("medium", "high") < slaHours("medium", "low"));
  });

  test("never below the two-hour floor — a clinician still has to read it", () => {
    for (const c of ["low", "medium", "high"] as const) {
      for (const r of ["low", "medium", "high"] as const) {
        assert.ok(slaHours(c, r) >= MIN_SLA_HOURS, `${c}/${r}`);
      }
    }
  });

  test("double review takes longer than single", () => {
    assert.ok(slaHours("high", "low", "double") > slaHours("high", "low", "single"));
  });
});
