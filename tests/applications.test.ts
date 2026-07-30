import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  reviewExpertApplication,
  scoreExpertApplication,
  applyModelScores,
  averageScore,
  expertOutcomeMessage,
  EXPERT_DIMENSIONS,
  MIN_YEARS_EXPERIENCE,
  APPROVE_AVERAGE,
  REJECT_AVERAGE,
  type ExpertApplication,
  evaluatePartner,
  publicView,
  recommendationFor,
  riskLevelFor,
  missingPrerequisites,
  PRIVATE_DIMENSIONS,
  type PartnerApplication,
  type PrivateScores,
} from "@harmony/applications";

/* --- Fixtures ------------------------------------------------------------ */

const strongExpert: ExpertApplication = {
  name: "Dr Amina Sow",
  email: "amina@example-hospital.org",
  specialty: "cardiology",
  subSpecialty: "interventional cardiology",
  credentials: "MD, board certified in cardiovascular disease, interventional cardiology fellowship",
  yearsExperience: 12,
  licenseNumber: "GMC-7741820",
  institution: "Groote Schuur Hospital, University of Cape Town",
  bio: "Interventional cardiologist running a structural heart programme, with a decade of catheter lab practice and an active role in the regional STEMI network. Publishes on procedural outcomes and supervises fellows.",
  linkedinUrl: "https://linkedin.com/in/example",
  orcidId: "0000-0002-1825-0097",
  weeklyHours: 12,
  motivation: "Interested in reviewing AI-generated cardiology output because I see it in clinic already.",
};

const scores = (fill: number): PrivateScores =>
  Object.fromEntries(PRIVATE_DIMENSIONS.map((d) => [d, fill])) as PrivateScores;

const partnerScores = (overrides: Partial<PrivateScores>): PrivateScores => ({
  ...scores(70),
  riskScore: 20,
  ...overrides,
});

const validPartner: PartnerApplication = {
  companyName: "Northwind Clinical AI",
  workEmail: "partnerships@northwind.example",
  website: "https://northwind.example",
  partnershipType: "integration",
  description: "Ambient documentation for outpatient clinics.",
  agreesPartnershipAgreement: true,
  agreesConfidentiality: true,
};

/* --- Expert: hard gates --------------------------------------------------- */

describe("expert application — the four absolute requirements", () => {
  test("a strong application is approved", () => {
    const decision = reviewExpertApplication(strongExpert);
    assert.equal(decision.decision, "approved");
    assert.equal(decision.nextStatus, "active");
    assert.deepEqual(decision.blockers, []);
    assert.ok(decision.average >= APPROVE_AVERAGE);
  });

  test("under three years is rejected however good everything else is", () => {
    const decision = reviewExpertApplication({ ...strongExpert, yearsExperience: 2 });
    assert.equal(decision.decision, "rejected");
    assert.equal(decision.nextStatus, "suspended");
    assert.match(decision.rationale, /three years|3 years/i);
  });

  test("no license number is rejected", () => {
    const decision = reviewExpertApplication({ ...strongExpert, licenseNumber: null });
    assert.equal(decision.decision, "rejected");
    assert.ok(decision.blockers.some((b) => /license/i.test(b)));
  });

  test('"N/A" is treated as no license, not as an answer', () => {
    const decision = reviewExpertApplication({ ...strongExpert, licenseNumber: "N/A" });
    assert.equal(decision.decision, "rejected");
    assert.ok(decision.blockers.some((b) => /license/i.test(b)));
  });

  test("no institution is rejected", () => {
    const decision = reviewExpertApplication({ ...strongExpert, institution: "  " });
    assert.equal(decision.decision, "rejected");
    assert.ok(decision.blockers.some((b) => /institution/i.test(b)));
  });

  test("every failed gate is reported, not just the first", () => {
    const decision = reviewExpertApplication({
      ...strongExpert,
      yearsExperience: 1,
      licenseNumber: "",
      institution: "",
    });
    assert.equal(decision.decision, "rejected");
    assert.ok(decision.blockers.length >= 3, `expected 3+ blockers, got ${decision.blockers.length}`);
  });

  test("exactly three years clears the experience gate", () => {
    const decision = reviewExpertApplication({ ...strongExpert, yearsExperience: MIN_YEARS_EXPERIENCE });
    assert.equal(decision.decision, "approved");
  });
});

/* --- Expert: scoring ------------------------------------------------------ */

describe("expert application — scoring", () => {
  test("every dimension is scored 1–10", () => {
    const s = scoreExpertApplication(strongExpert);
    for (const dimension of EXPERT_DIMENSIONS) {
      assert.ok(s[dimension] >= 1 && s[dimension] <= 10, `${dimension} = ${s[dimension]}`);
    }
  });

  test("the same application always produces the same result", () => {
    const a = reviewExpertApplication(strongExpert);
    const b = reviewExpertApplication(strongExpert);
    assert.deepEqual(a.scores, b.scores);
    assert.equal(a.average, b.average);
    assert.equal(a.rationale, b.rationale);
  });

  test("a below-threshold average is rejected even with all four gates met", () => {
    const thin: ExpertApplication = {
      name: "Dr X",
      email: "x@example.org",
      specialty: "other",
      credentials: "",
      yearsExperience: 3,
      licenseNumber: "12345",
      institution: "Clinic",
      bio: "",
      weeklyHours: 0,
    };
    const decision = reviewExpertApplication(thin);
    assert.ok(decision.average < REJECT_AVERAGE, `average was ${decision.average}`);
    assert.equal(decision.decision, "rejected");
  });

  test("a model cannot invent a license — factual dimensions are not overridable", () => {
    const noLicense = { ...strongExpert, licenseNumber: null };
    const baseline = scoreExpertApplication(noLicense);
    const merged = applyModelScores(baseline, { licenseValidity: 10, experienceLevel: 10 });

    assert.equal(merged.licenseValidity, baseline.licenseValidity);
    assert.equal(merged.experienceLevel, baseline.experienceLevel);

    // And the gate still rejects, whatever the model claimed.
    assert.equal(reviewExpertApplication(noLicense, { licenseValidity: 10 }).decision, "rejected");
  });

  test("a model may move the qualitative dimensions", () => {
    const baseline = scoreExpertApplication(strongExpert);
    const merged = applyModelScores(baseline, { bioQuality: 10 });
    assert.equal(merged.bioQuality, 10);
    assert.ok(averageScore(merged) >= averageScore(baseline));
  });

  test("the 5.0–6.0 band approves but is flagged for a human", () => {
    const borderline = reviewExpertApplication(strongExpert, {
      credentialsCompleteness: 5,
      institutionCredibility: 5,
      specialtyClarity: 5,
      bioQuality: 4,
      motivationAvailability: 4,
    });
    if (borderline.average >= REJECT_AVERAGE && borderline.average < APPROVE_AVERAGE) {
      assert.equal(borderline.decision, "approved");
      assert.equal(borderline.borderline, true);
      assert.match(borderline.rationale, /band|second look/i);
    }
  });
});

describe("expert application — what the applicant is told", () => {
  test("a rejection carries the actual reasons", () => {
    const decision = reviewExpertApplication({ ...strongExpert, yearsExperience: 1 });
    const message = expertOutcomeMessage(strongExpert, decision);
    assert.ok(message.body.join(" ").length > 60);
    assert.ok(decision.blockers.every((b) => message.body.includes(b)));
  });

  test("an approval says the agreement gates assignment", () => {
    const decision = reviewExpertApplication(strongExpert);
    const message = expertOutcomeMessage(strongExpert, decision);
    assert.match(message.body.join(" "), /agreement/i);
    assert.ok(message.nextSteps.some((s) => /2\.5/.test(s)));
    // Payout details are a portal step, never an email or a form attachment.
    assert.ok(message.nextSteps.some((s) => /portal/i.test(s) && /payout/i.test(s)));
  });
});

/* --- Partner: prerequisites ---------------------------------------------- */

describe("partner application — prerequisites", () => {
  test("a complete application has none missing", () => {
    assert.deepEqual(missingPrerequisites(validPartner), []);
  });

  test("refusing confidentiality is declined without being scored", () => {
    const result = evaluatePartner({ ...validPartner, agreesConfidentiality: false }, partnerScores({}));
    assert.equal(result.recommendation, "declined");
    assert.equal(result.privateScores, null);
    assert.match(result.missingPrerequisites.join(" "), /confidentiality/i);
  });

  test("refusing the partnership agreement is declined", () => {
    const result = evaluatePartner(
      { ...validPartner, agreesPartnershipAgreement: false },
      partnerScores({}),
    );
    assert.equal(result.recommendation, "declined");
  });

  test("a missing company name or work email is declined", () => {
    assert.equal(
      evaluatePartner({ ...validPartner, companyName: "" }, partnerScores({})).recommendation,
      "declined",
    );
    assert.equal(
      evaluatePartner({ ...validPartner, workEmail: "not-an-email" }, partnerScores({})).recommendation,
      "declined",
    );
  });
});

/* --- Partner: thresholds -------------------------------------------------- */

describe("partner application — risk and recommendation", () => {
  test("risk bands sit where the specification puts them", () => {
    assert.equal(riskLevelFor(0), "Low");
    assert.equal(riskLevelFor(34), "Low");
    assert.equal(riskLevelFor(35), "Medium");
    assert.equal(riskLevelFor(65), "Medium");
    assert.equal(riskLevelFor(66), "High");
    assert.equal(riskLevelFor(100), "High");
  });

  test("high risk declines regardless of how well the partner scores", () => {
    assert.equal(recommendationFor(95, "High"), "declined");
    assert.equal(recommendationFor(70, "High"), "declined");
    const result = evaluatePartner(validPartner, partnerScores({ riskScore: 90 }));
    assert.equal(result.riskLevel, "High");
    assert.equal(result.recommendation, "declined");
    assert.match(result.rationale, /risk/i);
  });

  test("the five tiers", () => {
    assert.equal(recommendationFor(90, "Low"), "approved");
    // 90 with medium risk is strong but not clean — it drops a tier.
    assert.equal(recommendationFor(90, "Medium"), "approved_with_recommendations");
    assert.equal(recommendationFor(78, "Medium"), "approved_with_recommendations");
    assert.equal(recommendationFor(64, "Medium"), "under_review");
    assert.equal(recommendationFor(45, "Medium"), "not_a_current_fit");
    assert.equal(recommendationFor(30, "Low"), "declined");
  });

  test("business potential is the mean of the two commercial dimensions", () => {
    const result = evaluatePartner(
      validPartner,
      partnerScores({ businessPotential: 40, revenuePotential: 80 }),
    );
    assert.equal(result.publicScores.businessPotential, 60);
  });

  test("overall compatibility is the mean of the five public dimensions", () => {
    const result = evaluatePartner(validPartner, partnerScores({}));
    const p = result.publicScores;
    const expected = Math.round(
      (p.strategicAlignment + p.technicalFit + p.businessPotential + p.complianceReadiness + p.innovation) / 5,
    );
    assert.equal(result.overallCompatibility, expected);
  });

  test("scores outside 0–100 are clamped rather than trusted", () => {
    const result = evaluatePartner(
      validPartner,
      partnerScores({ strategicAlignment: 400, innovationScore: -50 }),
    );
    assert.equal(result.publicScores.strategicAlignment, 100);
    assert.equal(result.publicScores.innovation, 0);
  });
});

/* --- Partner: the private/public boundary --------------------------------- */

describe("partner application — nothing private reaches the applicant", () => {
  const evaluation = evaluatePartner(
    validPartner,
    partnerScores({ dataQuality: 91, longTermValue: 88, revenuePotential: 77, riskScore: 12 }),
  );

  test("the applicant sees exactly five dimensions", () => {
    assert.equal(publicView(evaluation).dimensions.length, 5);
  });

  test("no private dimension name appears in the applicant payload", () => {
    const serialised = JSON.stringify(publicView(evaluation));
    for (const dimension of PRIVATE_DIMENSIONS) {
      // The three that are also public names are exempt by construction.
      if (["strategicAlignment", "innovationScore", "businessPotential"].includes(dimension)) continue;
      assert.ok(!serialised.includes(dimension), `leaked ${dimension}`);
    }
  });

  test("internal commercial assessment is never in the applicant payload", () => {
    const serialised = JSON.stringify(publicView(evaluation));
    assert.ok(!serialised.includes("revenueOpportunity"));
    assert.ok(!serialised.includes("priorityTier"));
    assert.ok(!serialised.includes("accountManager"));
    assert.ok(!serialised.includes(String(evaluation.internal.revenueOpportunityUsd)));
  });

  test("the private scores are still available to Harmony", () => {
    assert.ok(evaluation.privateScores);
    assert.equal(evaluation.privateScores?.dataQuality, 91);
    assert.ok(evaluation.internal.revenueOpportunityUsd > 0);
  });
});
