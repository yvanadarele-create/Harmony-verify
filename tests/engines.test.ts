import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  processVerificationRequest,
  detectSpecialty,
  assessRisk,
  assessComplexity,
  scoreReport,
  summariseReport,
  isReviewComplete,
} from "@harmony/verification-engine";
import { matchExpert, ineligibilityReason, availableIn } from "@harmony/expert-matching";
import type { Expert, Review, Submission } from "@harmony/shared";

/* --- Fixtures ----------------------------------------------------------- */

const expert = (over: Partial<Expert> = {}): Expert => ({
  id: "exp_1",
  userId: "usr_1",
  name: "Dr A. Osei",
  specialty: "cardiology",
  credentials: "MD, FACC",
  yearsExperience: 12,
  availability: "available",
  rating: 4.8,
  ratingCount: 40,
  status: "active",
  conflictsOfInterest: [],
  activeCaseCount: 0,
  maxConcurrentCases: 5,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

const CARDIAC_TEXT =
  "72 y/o male post-MI discharged on dual antiplatelet therapy. Continue clopidogrel 75 mg " +
  "daily. Patient also takes omeprazole. Check troponin and ECG. Watch for interaction.";

/* --- Classification ----------------------------------------------------- */

describe("verification-engine — classification", () => {
  test("detects cardiology from clinical vocabulary", () => {
    const g = detectSpecialty(CARDIAC_TEXT);
    assert.equal(g.specialty, "cardiology");
    assert.ok(g.confidence >= 0.5);
  });

  test("returns 'other' when nothing clinical is present", () => {
    assert.equal(detectSpecialty("The weather is pleasant today.").specialty, "other");
  });

  test("dosing and interactions raise risk", () => {
    const risky = assessRisk(CARDIAC_TEXT);
    const benign = assessRisk("General wellness advice about staying hydrated.");
    assert.ok(risky.score > benign.score);
    assert.ok(["medium", "high"].includes(risky.risk));
    assert.equal(benign.risk, "low");
  });

  test("comorbidity and impairment signals raise complexity", () => {
    const hard = assessComplexity(
      "Patient has multiple comorbid conditions, renal impairment, polypharmacy and a drug interaction.",
    );
    assert.equal(hard.complexity, "high");
    assert.ok(hard.reasons.length >= 3);
  });
});

/* --- processVerificationRequest ----------------------------------------- */

describe("verification-engine — processVerificationRequest", () => {
  test("produces the full analysis contract", () => {
    const a = processVerificationRequest({
      content: CARDIAC_TEXT,
      declaredSpecialty: "cardiology",
      reviewType: "single-verification",
      priority: "standard",
    });
    assert.equal(a.specialty, "cardiology");
    assert.ok(["low", "medium", "high"].includes(a.complexity));
    assert.ok(["low", "medium", "high"].includes(a.risk));
    assert.ok(a.recommendedExpert.minYearsExperience > 0);
    assert.ok(a.estimatedTimeHours > 0);
    assert.ok(a.estimatedPrice.minCents > 0);
    assert.ok(a.rationale.length > 0, "must explain itself");
  });

  test("fills in specialty when the customer selected 'other'", () => {
    const a = processVerificationRequest({
      content: CARDIAC_TEXT,
      declaredSpecialty: "other",
      reviewType: "single-verification",
      priority: "standard",
    });
    assert.equal(a.specialty, "cardiology");
    assert.ok(a.rationale.some((r) => r.includes("detected")));
  });

  test("does not silently override a declared specialty — it flags instead", () => {
    const a = processVerificationRequest({
      content: CARDIAC_TEXT,
      declaredSpecialty: "oncology",
      reviewType: "single-verification",
      priority: "standard",
    });
    assert.equal(a.specialty, "oncology", "customer's choice is respected");
    assert.ok(
      a.rationale.some((r) => r.toLowerCase().includes("flagged")),
      "mismatch must be surfaced for human routing review",
    );
  });

  test("high risk escalates a standard request to urgent", () => {
    const a = processVerificationRequest({
      content:
        "Emergency: patient with chest pain and shortness of breath. Advised to stop taking " +
        "anticoagulant. Consider sepsis. Overdose risk with this dose of 500 mg.",
      declaredSpecialty: "cardiology",
      reviewType: "single-verification",
      priority: "standard",
    });
    assert.equal(a.risk, "high");
    assert.ok(a.rationale.some((r) => r.includes("Priority raised")));
    // Escalation must actually shorten turnaround, not merely annotate it.
    const benign = processVerificationRequest({
      content: "Routine advice about staying hydrated and sleeping well.",
      declaredSpecialty: "general-medicine",
      reviewType: "single-verification",
      priority: "standard",
    });
    assert.ok(a.estimatedTimeHours < benign.estimatedTimeHours);
  });

  test("higher risk demands a more senior reviewer", () => {
    const benign = processVerificationRequest({
      content: "Reminder to drink water and sleep well.",
      declaredSpecialty: "general-medicine",
      reviewType: "single-verification",
      priority: "standard",
    });
    const severe = processVerificationRequest({
      content:
        "Emergency chest pain, sepsis, anaphylaxis, overdose, contraindication, interaction, " +
        "paediatric patient, stop taking medication immediately.",
      declaredSpecialty: "cardiology",
      reviewType: "single-verification",
      priority: "standard",
    });
    assert.ok(
      severe.recommendedExpert.minYearsExperience > benign.recommendedExpert.minYearsExperience,
    );
    assert.ok(severe.recommendedExpert.minRating > benign.recommendedExpert.minRating);
  });
});

/* --- Expert matching ---------------------------------------------------- */

describe("expert-matching", () => {
  const analysis = {
    specialty: "cardiology" as const,
    risk: "medium" as const,
    recommendedExpert: { specialty: "cardiology" as const, minYearsExperience: 5, minRating: 4.0 },
  };

  test("picks the highest-scoring eligible reviewer", () => {
    const weak = expert({ id: "exp_weak", rating: 4.1, ratingCount: 10, yearsExperience: 6 });
    const strong = expert({ id: "exp_strong", rating: 4.9, ratingCount: 80, yearsExperience: 18 });
    const r = matchExpert({ analysis, experts: [weak, strong] });
    assert.equal(r.matched.id, "exp_strong");
    assert.equal(r.runnersUp[0]?.expert.id, "exp_weak");
    assert.ok(r.reasons.length > 0);
  });

  test("hard gates cannot be bought past by a high rating", () => {
    const perfect = { rating: 5, ratingCount: 500, yearsExperience: 30 };
    const cases: Array<[string, Expert]> = [
      ["suspended", expert({ ...perfect, status: "suspended" })],
      ["unavailable", expert({ ...perfect, availability: "unavailable" })],
      ["at capacity", expert({ ...perfect, activeCaseCount: 5, maxConcurrentCases: 5 })],
      ["wrong specialty", expert({ ...perfect, specialty: "oncology" })],
      ["too junior", expert({ ...perfect, yearsExperience: 1 })],
    ];
    for (const [label, e] of cases) {
      assert.ok(ineligibilityReason(e, { analysis, experts: [e] }), `${label} must be ineligible`);
      assert.throws(
        () => matchExpert({ analysis, experts: [e] }),
        /No eligible/,
        `${label} must not be matched`,
      );
    }
  });

  test("conflict of interest excludes an otherwise perfect reviewer", () => {
    const conflicted = expert({ conflictsOfInterest: ["CardioAI Inc"] });
    assert.throws(
      () =>
        matchExpert({
          analysis,
          experts: [conflicted],
          customerOrganisation: "cardioai inc",
        }),
      /No eligible/,
      "conflict matching must be case-insensitive",
    );
    // Same expert, different customer — fine.
    const ok = matchExpert({ analysis, experts: [conflicted], customerOrganisation: "Other Health" });
    assert.equal(ok.matched.id, conflicted.id);
  });

  test("an unrated expert is not excluded by the rating floor", () => {
    const fresh = expert({ id: "exp_new", rating: 0, ratingCount: 0, yearsExperience: 8 });
    const r = matchExpert({ analysis, experts: [fresh] });
    assert.equal(r.matched.id, "exp_new");
  });

  test("a rated-but-weak expert is excluded by the rating floor", () => {
    const weak = expert({ rating: 3.2, ratingCount: 25, yearsExperience: 8 });
    assert.match(ineligibilityReason(weak, { analysis, experts: [weak] }) ?? "", /rating/);
  });

  test("throws with diagnostics rather than returning a bad match", () => {
    try {
      matchExpert({ analysis, experts: [expert({ specialty: "oncology" })] });
      assert.fail("should have thrown");
    } catch (e: unknown) {
      const err = e as { status: number; code: string; details: { rejections: unknown[] } };
      assert.equal(err.status, 503);
      assert.equal(err.code, "no_eligible_expert");
      assert.equal(err.details.rejections.length, 1, "must say why each expert was rejected");
    }
  });

  test("availableIn lists only reviewers who can take work now", () => {
    const list = availableIn(
      [
        expert({ id: "a" }),
        expert({ id: "b", status: "suspended" }),
        expert({ id: "c", activeCaseCount: 5, maxConcurrentCases: 5 }),
        expert({ id: "d", specialty: "oncology" }),
      ],
      "cardiology",
    );
    assert.deepEqual(list.map((e) => e.id), ["a"]);
  });

  test("ranking is stable for identically-scored experts", () => {
    const a = expert({ id: "exp_aaa" });
    const b = expert({ id: "exp_bbb" });
    const first = matchExpert({ analysis, experts: [a, b] }).matched.id;
    const second = matchExpert({ analysis, experts: [b, a] }).matched.id;
    assert.equal(first, second, "input order must not change the winner");
  });
});

/* --- Report scoring ----------------------------------------------------- */

describe("verification-engine — report", () => {
  const submission: Submission = {
    id: "sub_1",
    customerId: "usr_1",
    title: "Discharge summary",
    aiSystem: "CardioAssist v3",
    content: CARDIAC_TEXT,
    specialty: "cardiology",
    reviewType: "single-verification",
    priority: "standard",
    status: "under-review",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const review = (over: Partial<Review> = {}): Review => ({
    id: "rev_1",
    submissionId: "sub_1",
    expertId: "exp_1",
    status: "submitted",
    accuracy: "accurate",
    hallucinationDetected: false,
    missingInformation: false,
    safetyLevel: "safe",
    clinicalReasoning: "strong",
    verdict: "verified",
    assignedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  });

  test("a clean review scores 100", () => {
    assert.equal(scoreReport(review()).score, 100);
  });

  test("each finding deducts, and deductions are itemised", () => {
    const s = scoreReport(
      review({
        accuracy: "incorrect",
        hallucinationDetected: true,
        safetyLevel: "unsafe",
        clinicalReasoning: "poor",
        missingInformation: true,
      }),
    );
    assert.equal(s.score, 0, "worst case floors at zero, never negative");
    assert.equal(s.deductions.length, 5);
    assert.ok(s.deductions.every((d) => d.points > 0 && d.reason.length > 0));
  });

  test("score decreases monotonically with severity", () => {
    const clean = scoreReport(review()).score;
    const minor = scoreReport(review({ accuracy: "minor-issues" })).score;
    const bad = scoreReport(review({ accuracy: "incorrect" })).score;
    assert.ok(clean > minor && minor > bad);
  });

  test("summary renders all seven required sections", () => {
    const scored = scoreReport(review({ accuracy: "minor-issues" }));
    const { sections, summary } = summariseReport(submission, review({ accuracy: "minor-issues" }), scored);
    assert.equal(sections.length, 7);
    assert.match(sections[0]!.heading, /AI Output Reviewed/);
    assert.match(sections[6]!.heading, /Final Reliability Score/);
    assert.ok(sections.every((s) => s.body.trim().length > 0), "no empty sections");
    assert.match(summary, /\d+\/100/);
  });

  test("hallucination details reach the report when present", () => {
    const r = review({ hallucinationDetected: true, hallucinationDetails: "Fabricated citation to NEJM 2019." });
    const { sections } = summariseReport(submission, r, scoreReport(r));
    assert.match(sections[3]!.body, /Fabricated citation/);
  });

  test("isReviewComplete requires every finding", () => {
    assert.ok(isReviewComplete(review()));
    assert.ok(!isReviewComplete(review({ verdict: undefined })));
    assert.ok(!isReviewComplete(review({ safetyLevel: undefined })));
  });
});
