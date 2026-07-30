import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildReport,
  toText,
  toPdf,
  toDocx,
  verificationReadyEmail,
  containsClinicalContent,
  deidentify,
  extract,
  isExtractable,
  pack,
  toJsonl,
  type ReportInput,
} from "@harmony/deliverables";
import { scoreReport } from "@harmony/verification-engine";
import type { Review, Submission } from "@harmony/shared";

/* --- Fixtures ------------------------------------------------------------- */

const submission: Submission = {
  id: "sub-0000000417",
  customerId: "cust-1",
  title: "Chest pain triage response — model v3.2",
  aiSystem: "GPT-4",
  content:
    "Patient reports intermittent chest discomfort on exertion, resolving with rest. Recommend reassurance and routine follow-up in 6 weeks. No further investigation indicated at this time.",
  fileUrl: undefined,
  specialty: "cardiology",
  reviewType: "single-verification",
  priority: "urgent",
  complexity: "high",
  riskLevel: "high",
  status: "completed",
  assignedExpertId: "exp-1",
  priceCents: 61_364,
  eta: undefined,
  reportUrl: undefined,
  createdAt: "2026-07-28T09:00:00.000Z",
  updatedAt: "2026-07-30T09:00:00.000Z",
};

const review: Review = {
  id: "rev-1",
  submissionId: submission.id,
  expertId: "exp-1",
  status: "submitted",
  accuracy: "incorrect",
  hallucinationDetected: false,
  hallucinationDetails: undefined,
  missingInformation: true,
  missingInformationDetails:
    "Exertional chest pain relieved by rest is textbook stable angina and warrants urgent cardiology assessment, not routine follow-up. No mention of risk-factor assessment, ECG or troponin.",
  safetyLevel: "unsafe",
  clinicalReasoning: "poor",
  verdict: "unsafe",
  comments:
    "Corrected recommendation: treat as suspected stable angina. Perform a 12-lead ECG, assess cardiovascular risk factors, start antiplatelet and antianginal therapy per local guidance, and refer for urgent cardiology assessment within two weeks. Reassurance with six-week follow-up risks an interval myocardial infarction.",
  assignedAt: "2026-07-29T10:00:00.000Z",
  acceptedAt: "2026-07-29T10:20:00.000Z",
  submittedAt: "2026-07-30T08:30:00.000Z",
};

const reviewer = {
  name: "Dr Amina Sow",
  credentials: "MD, board certified in cardiovascular disease",
  specialty: "cardiology",
  licenseNumber: "GMC-7741820",
  institution: "Groote Schuur Hospital",
  yearsExperience: 12,
};

const scored = scoreReport(review);

const input: ReportInput = {
  submission,
  review,
  reviewer,
  score: scored.score,
  deductions: scored.deductions,
  organisation: "Northwind Clinical AI",
  now: new Date("2026-07-30T12:00:00.000Z"),
};

const report = buildReport(input);

/* --- The report model ------------------------------------------------------ */

describe("the verification report", () => {
  test("opens by thanking the customer", () => {
    const first = report.blocks[0]!;
    assert.match(first.heading, /thank you/i);
    assert.match(first.body!.join(" "), /trusting Harmony Verify with the reliability of your AI outputs/);
    assert.match(first.body!.join(" "), /Northwind Clinical AI/);
  });

  test("carries a reference, verdict and score", () => {
    assert.match(report.reference, /^HV-\d{8}-[A-Z0-9]{6}$/);
    assert.equal(report.verdict, "Unsafe — do not deploy");
    assert.equal(report.score, scored.score);
    assert.ok(report.score < 100, "an unsafe review should not score 100");
  });

  test("includes the original output unedited", () => {
    const text = toText(report);
    assert.ok(text.includes(submission.content));
  });

  test("assesses every rubric dimension", () => {
    const assessment = report.blocks.find((b) => b.heading === "Assessment")!;
    const labels = assessment.rows!.map(([label]) => label);
    assert.deepEqual(labels, [
      "Medical accuracy",
      "Hallucination detected",
      "Missing information",
      "Safety",
      "Clinical reasoning",
    ]);
  });

  test("itemises how the score was reached", () => {
    const block = report.blocks.find((b) => b.heading === "How this score was reached")!;
    const rows = block.rows!;
    // Every deduction, then the final score.
    assert.equal(rows.length, scored.deductions.length + 1);
    assert.deepEqual(rows[rows.length - 1], ["Final score", `${scored.score} / 100`]);
  });

  test("ends with the reviewer's name and credentials", () => {
    const last = report.blocks[report.blocks.length - 1]!;
    assert.equal(last.heading, "Reviewer");
    const values = last.rows!.map(([, value]) => value);
    assert.ok(values.includes("Dr Amina Sow"));
    assert.ok(values.includes("GMC-7741820"));
    assert.match(last.body!.join(" "), /does not practise medicine/);
  });

  test("carries the corrections, which is the thing being bought", () => {
    const text = toText(report);
    assert.ok(text.includes("urgent cardiology assessment"));
  });
});

/* --- PDF -------------------------------------------------------------------- */

describe("the PDF deliverable", () => {
  const pdf = toPdf(report);

  test("is a well-formed PDF", () => {
    const head = Buffer.from(pdf.slice(0, 8)).toString("latin1");
    const tail = Buffer.from(pdf.slice(-16)).toString("latin1");
    assert.match(head, /^%PDF-1\.\d/);
    assert.match(tail, /%%EOF\s*$/);
  });

  test("has a cross-reference table pointing at real offsets", () => {
    const text = Buffer.from(pdf).toString("latin1");
    const startxref = /startxref\s+(\d+)/.exec(text);
    assert.ok(startxref, "no startxref");
    const offset = Number(startxref![1]);
    assert.equal(text.slice(offset, offset + 4), "xref");
  });

  test("contains the report's content", () => {
    const text = Buffer.from(pdf).toString("latin1");
    assert.ok(text.includes("Thank you for trusting Harmony Verify"));
    assert.ok(text.includes("Dr Amina Sow"));
    assert.ok(text.includes(report.reference));
  });

  test("paginates rather than overflowing one page", () => {
    const text = Buffer.from(pdf).toString("latin1");
    const pages = (text.match(/\/Type \/Page[^s]/g) ?? []).length;
    assert.ok(pages >= 2, `expected multiple pages, got ${pages}`);
    const count = /\/Count (\d+)/.exec(text);
    assert.equal(Number(count![1]), pages);
  });

  test("declares every font it references", () => {
    const text = Buffer.from(pdf).toString("latin1");
    for (const font of ["F1", "F2", "F3"]) {
      assert.ok(text.includes(`/${font} `), `font ${font} not declared`);
    }
  });

  test("is byte-identical for identical input", () => {
    assert.deepEqual(toPdf(buildReport(input)), pdf);
  });

  test("typographic characters are transliterated to their WinAnsi codes", () => {
    const text = Buffer.from(pdf).toString("latin1");
    // The verdict carries an em dash. Emitting the Latin-1 code point instead of
    // the WinAnsi one prints Ð, which looks like a corrupt file.
    assert.ok(text.includes("\\227"), "em dash not transliterated to WinAnsi 0x97");
    assert.ok(!text.includes("\\320"), "em dash emitted as Latin-1 0xD0");
    // Nothing above the byte range should survive as a raw multi-byte sequence.
    assert.ok(!/[Ā-￿]/.test(text), "non-Latin-1 character written raw");
  });
});

/* --- DOCX ------------------------------------------------------------------- */

describe("the Word deliverable", () => {
  const docx = toDocx(report);

  test("is a ZIP", () => {
    assert.equal(docx[0], 0x50);
    assert.equal(docx[1], 0x4b);
  });

  test("unzips, and the parts a reader needs are present", () => {
    const dir = mkdtempSync(join(tmpdir(), "hv-docx-"));
    const file = join(dir, "report.docx");
    writeFileSync(file, docx);

    // Real extraction rather than byte-poking: if unzip can read it, Word can.
    execFileSync("unzip", ["-qq", "-o", file, "-d", dir]);

    for (const part of [
      "[Content_Types].xml",
      "_rels/.rels",
      "word/document.xml",
      "word/_rels/document.xml.rels",
      "docProps/core.xml",
    ]) {
      assert.ok(existsSync(join(dir, part)), `missing part ${part}`);
    }

    const document = readFileSync(join(dir, "word/document.xml"), "utf8");
    assert.match(document, /^<\?xml/);
    assert.ok(document.includes("Thank you for trusting Harmony Verify"));
    assert.ok(document.includes("Dr Amina Sow"));
    assert.ok(document.includes(report.reference));
  });

  test("escapes content rather than breaking the XML", () => {
    const awkward = buildReport({
      ...input,
      submission: { ...submission, title: 'Ampersand & "quotes" <tags>' },
    });
    const dir = mkdtempSync(join(tmpdir(), "hv-docx2-"));
    const file = join(dir, "r.docx");
    writeFileSync(file, toDocx(awkward));
    execFileSync("unzip", ["-qq", "-o", file, "-d", dir]);
    const document = readFileSync(join(dir, "word/document.xml"), "utf8");
    assert.ok(document.includes("Ampersand &amp; &quot;quotes&quot; &lt;tags&gt;"));
  });
});

/* --- The notification ------------------------------------------------------- */

describe("the ready notification", () => {
  const email = verificationReadyEmail({
    report,
    recipientName: "Sam",
    reportUrl: "https://harmonyverify.com/dashboard/reports/HV-20260730-000417",
  });

  test("says a report is ready and where to get it", () => {
    assert.match(email.subject, /ready/i);
    assert.ok(email.subject.includes(report.reference));
    assert.ok(email.text.includes("https://harmonyverify.com/dashboard/reports/"));
    assert.ok(email.html.includes("SIGN IN AND DOWNLOAD"));
  });

  test("thanks the customer", () => {
    assert.match(email.text, /trusting Harmony Verify with the reliability of your AI outputs/);
  });

  test("carries no clinical content at all", () => {
    const leaked = containsClinicalContent(email);
    assert.deepEqual(leaked, [], `notification leaked: ${leaked.join(", ")}`);
  });

  test("does not carry the verdict, the score or the findings", () => {
    const haystack = `${email.subject} ${email.text} ${email.html}`;
    assert.ok(!haystack.includes("Unsafe"));
    assert.ok(!haystack.includes("angina"));
    // The bare number would match a date or a phone number, so assert on the
    // shape a score is actually presented in.
    assert.ok(!/\/\s*100\b/.test(haystack));
    assert.ok(!/\bscore\b/i.test(haystack));
    assert.ok(!/\breliability score\b/i.test(haystack));
  });
});

/* --- De-identification ------------------------------------------------------ */

describe("de-identification", () => {
  test("removes contact details", () => {
    const { text, redactions } = deidentify(
      "Contact Dr Sarah Miller at s.miller@hospital.example or 020 7946 0958.",
    );
    assert.ok(!text.includes("s.miller@hospital.example"));
    assert.ok(!text.includes("Sarah Miller"));
    assert.ok(redactions.includes("email address"));
    assert.ok(redactions.includes("named person"));
  });

  test("removes record numbers and dates of birth", () => {
    const { text } = deidentify("MRN: A88213004, DOB 04/11/1962, seen 12/07/2026.");
    assert.ok(!text.includes("A88213004"));
    assert.ok(!text.includes("04/11/1962"));
    assert.ok(!text.includes("12/07/2026"));
  });

  test("leaves clinical content intact — the row exists for it", () => {
    const { text } = deidentify(
      "Exertional chest pain relieved by rest. Start aspirin 75mg and refer to cardiology.",
    );
    assert.ok(text.includes("Exertional chest pain"));
    assert.ok(text.includes("aspirin 75mg"));
    assert.ok(text.includes("cardiology"));
  });

  test("reports nothing when there was nothing to remove", () => {
    assert.deepEqual(deidentify("Recommend a 12-lead ECG.").redactions, []);
  });
});

/* --- Dataset extraction ------------------------------------------------------ */

describe("dataset extraction", () => {
  const consented = { ...submission, datasetConsent: true };
  const rowId = () => "row_fixed";

  test("consent is required — no consent, no row", () => {
    assert.equal(isExtractable({ submission, review }), false);
    assert.equal(extract({ submission, review }), null);
    assert.equal(extract({ submission: { ...submission, datasetConsent: false }, review }), null);
  });

  test("an incomplete review is not dataset material", () => {
    const draft: Review = { ...review, status: "accepted" };
    assert.equal(extract({ submission: consented, review: draft }), null);
  });

  test("a consented, completed review becomes a row", () => {
    const row = extract({ submission: consented, review, reviewer, rowId })!;
    assert.ok(row);
    assert.equal(row.id, "row_fixed");
    assert.equal(row.specialty, "cardiology");
    assert.equal(row.riskLevel, "high");
    assert.equal(row.verdict, "unsafe");
    assert.equal(row.accuracy, "incorrect");
    assert.equal(row.missingInformation, true);
    assert.equal(row.reviewerSpecialty, "cardiology");
    assert.equal(row.reviewerYearsExperience, 12);
  });

  test("the correction is captured — the most valuable field", () => {
    const row = extract({ submission: consented, review, reviewer, rowId })!;
    assert.ok(row.correction);
    assert.ok(row.correction!.includes("urgent cardiology assessment"));
  });

  test("the row carries no identity — not the customer's, not the reviewer's", () => {
    const row = extract({ submission: consented, review, reviewer, rowId })!;
    const serialised = JSON.stringify(row);
    assert.ok(!serialised.includes(submission.id));
    assert.ok(!serialised.includes(submission.customerId));
    assert.ok(!serialised.includes("exp-1"));
    assert.ok(!serialised.includes("Amina Sow"));
    assert.ok(!serialised.includes("GMC-7741820"));
  });

  test("identifiers in the submitted text never reach the row", () => {
    const leaky = {
      ...consented,
      content: "Mr John Smith, MRN: X4482910, reported chest pain. Call 020 7946 0958.",
    };
    const row = extract({ submission: leaky, review, reviewer, rowId })!;
    assert.ok(!row.input.includes("John Smith"));
    assert.ok(!row.input.includes("X4482910"));
    assert.ok(row.redactions.length > 0);
    // A buyer can see what was removed and why.
    assert.ok(row.redactions.includes("named person"));
  });

  test("packs group by specialty with an honest summary", () => {
    const rows = [
      extract({ submission: consented, review, reviewer, rowId: () => "a" })!,
      extract({
        submission: { ...consented, specialty: "oncology" },
        review: { ...review, verdict: "verified", hallucinationDetected: true },
        reviewer,
        rowId: () => "b",
      })!,
      extract({ submission: consented, review, reviewer, rowId: () => "c" })!,
    ];

    const packs = pack(rows);
    const cardiology = packs.find((p) => p.specialty === "cardiology")!;

    assert.equal(packs.length, 2);
    assert.equal(cardiology.summary.total, 2);
    assert.equal(cardiology.summary.withCorrections, 2);
    assert.equal(cardiology.summary.byVerdict["unsafe"], 2);

    const oncology = packs.find((p) => p.specialty === "oncology")!;
    assert.equal(oncology.summary.withHallucinations, 1);
  });

  test("exports as JSONL, one parseable row per line", () => {
    const rows = [extract({ submission: consented, review, reviewer, rowId })!];
    const jsonl = toJsonl(rows);
    const lines = jsonl.trim().split("\n");
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]!).specialty, "cardiology");
    assert.equal(toJsonl([]), "");
  });
});
