import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { UnconfiguredStrategyProvider, generateBrand, generateBrandWithRetry, regenerateField } from "@brandora/ai";
import type { InterviewAnswer, StrategyProvider } from "@brandora/brand-engine";
import { buildBrief, parseStrategy } from "@brandora/brand-engine";
import { BrandoraError, ValidationError } from "@brandora/shared";

const answers: InterviewAnswer[] = [
  { field: "business", value: "A small bakery selling cookies from home" },
  { field: "product", value: "Cookies and small cakes" },
  { field: "audience", value: "Young professionals who order for the office" },
  { field: "positioning", value: "premium" },
  { field: "personality", value: ["elegant", "warm"] },
  { field: "differentiation", value: "Everything is baked the morning it is sold" },
  { field: "style", value: "Clean and minimal" },
];

const GOOD_REPLY = JSON.stringify({
  name: "Luma",
  nameAlternatives: ["Sablé", "Maison Luma", "Beurre"],
  description: "A home bakery making cookies and small cakes fresh each morning.",
  industry: "bakery",
  targetCustomer: "Young professionals ordering for the office",
  promise: "Baked this morning, or it does not go out.",
  mission: "Make the small everyday treat feel considered.",
  vision: "A Luma box on every office table in Abidjan.",
  slogan: "Baked this morning.",
  toneOfVoice: "Warm, short sentences, never salesy.",
  brandStory: "Luma started in a home kitchen with one oven and a rule about freshness.",
});

/** Records what it was asked, so the prompt contract can be asserted. */
class FakeProvider implements StrategyProvider {
  calls: { system: string; user: string; maxTokens?: number }[] = [];
  constructor(private readonly replies: (string | Error)[]) {}

  async complete(input: { system: string; user: string; maxTokens?: number }): Promise<string> {
    this.calls.push(input);
    const next = this.replies.shift();
    if (next === undefined) throw new Error("FakeProvider ran out of replies");
    if (next instanceof Error) throw next;
    return next;
  }
}

/* --- The happy path ------------------------------------------------------- */

describe("brand generation", () => {
  test("interview answers become a saved-shaped profile with a real identity", async () => {
    const provider = new FakeProvider([GOOD_REPLY]);
    const result = await generateBrand(provider, { userId: "usr_1", answers });

    assert.equal(result.strategy.name, "Luma");
    assert.equal(result.profile.userId, "usr_1");
    assert.equal(result.profile.positioning, "premium");
    assert.equal(result.profile.palette.length, 5);
    assert.match(result.profile.palette[0]!.hex, /^#[0-9A-F]{6}$/);
    assert.ok(result.profile.typography.primary.length > 0);
    assert.match(result.profile.logoBrief, /16px/);
  });

  test("the customer's answers reach the prompt", async () => {
    const provider = new FakeProvider([GOOD_REPLY]);
    await generateBrand(provider, { userId: "usr_1", answers });
    assert.match(provider.calls[0]!.user, /Cookies and small cakes/);
    assert.match(provider.calls[0]!.user, /premium/);
  });

  test("no credential is ever placed in a prompt", async () => {
    const provider = new FakeProvider([GOOD_REPLY]);
    await generateBrand(provider, { userId: "usr_1", answers });
    const sent = JSON.stringify(provider.calls);
    for (const forbidden of ["sk-ant", "ALIEXPRESS", "ANTHROPIC_API_KEY", "api_key", "password"]) {
      assert.ok(!sent.includes(forbidden), `prompt contained ${forbidden}`);
    }
  });

  test("the founder's own name is preserved when they have one", async () => {
    const provider = new FakeProvider([GOOD_REPLY]);
    await generateBrand(provider, { userId: "usr_1", answers, existingName: "Luma Cookies" });
    assert.match(provider.calls[0]!.user, /already called "Luma Cookies"/);
  });

  test("the founder's language reaches the prompt", async () => {
    const provider = new FakeProvider([GOOD_REPLY]);
    await generateBrand(provider, { userId: "usr_1", answers, locale: "fr" });
    assert.match(provider.calls[0]!.user, /in French/);
  });
});

/* --- Validation sits between the model and the domain --------------------- */

describe("a malformed generation never becomes a brand", () => {
  const cases: [string, string][] = [
    ["not JSON at all", "I'm sorry, I can't help with that."],
    ["empty string", ""],
    ["a JSON array instead of an object", "[]"],
    ["JSON with a missing required field", JSON.stringify({ ...JSON.parse(GOOD_REPLY), promise: undefined })],
    ["JSON with an empty required field", JSON.stringify({ ...JSON.parse(GOOD_REPLY), name: "" })],
    ["a field of the wrong type", JSON.stringify({ ...JSON.parse(GOOD_REPLY), name: 42 })],
    ["an over-long slogan", JSON.stringify({ ...JSON.parse(GOOD_REPLY), slogan: "a b c d e f g h" })],
    ["truncated JSON", GOOD_REPLY.slice(0, 60)],
  ];

  for (const [label, reply] of cases) {
    test(`rejects ${label}`, async () => {
      const provider = new FakeProvider([reply]);
      await assert.rejects(() => generateBrand(provider, { userId: "usr_1", answers }));
    });
  }

  test("code fences and preamble are recovered from, not rejected", async () => {
    const provider = new FakeProvider(["Here you go:\n```json\n" + GOOD_REPLY + "\n```"]);
    const result = await generateBrand(provider, { userId: "usr_1", answers });
    assert.equal(result.strategy.name, "Luma");
  });

  test("the model cannot override the positioning the founder chose", async () => {
    const hijack = JSON.stringify({ ...JSON.parse(GOOD_REPLY), positioning: "luxury" });
    const provider = new FakeProvider([hijack]);
    const result = await generateBrand(provider, { userId: "usr_1", answers });
    assert.equal(result.strategy.positioning, "premium");
    assert.equal(result.profile.positioning, "premium");
  });

  test("an incomplete interview fails before any paid call is made", async () => {
    const provider = new FakeProvider([GOOD_REPLY]);
    await assert.rejects(
      () => generateBrand(provider, { userId: "usr_1", answers: answers.slice(0, 2) }),
      ValidationError,
    );
    assert.equal(provider.calls.length, 0, "the model must not be called for a bad brief");
  });
});

/* --- Failure surfaces ----------------------------------------------------- */

describe("failures reach the customer as a sentence, not a stack trace", () => {
  test("a provider outage surfaces as a brand-generation failure", async () => {
    const provider = new FakeProvider([
      new BrandoraError("brand.generation-failed", "upstream 503"),
      new BrandoraError("brand.generation-failed", "upstream 503"),
    ]);
    await assert.rejects(
      () => generateBrandWithRetry(provider, { userId: "usr_1", answers }),
      (err: unknown) =>
        err instanceof BrandoraError && err.customerMessageKey === "brand.generation-failed",
    );
  });

  test("the customer message names no model, no status and no provider", async () => {
    const provider = new FakeProvider(["total nonsense", "total nonsense"]);
    try {
      await generateBrandWithRetry(provider, { userId: "usr_1", answers });
      assert.fail("should have thrown");
    } catch (err) {
      const message = (err as BrandoraError).toCustomerJSON().message;
      assert.doesNotMatch(message, /anthropic|claude|json|502|503|token/i);
      assert.match(message, /Your answers are saved/);
    }
  });

  test("with no API key configured, generation fails — it does not invent a brand", async () => {
    const provider = new UnconfiguredStrategyProvider();
    await assert.rejects(
      () => generateBrand(provider, { userId: "usr_1", answers }),
      (err: unknown) =>
        err instanceof BrandoraError &&
        err.customerMessageKey === "brand.generation-failed" &&
        /ANTHROPIC_API_KEY/.test(err.technicalDetail),
    );
  });
});

/* --- Retry ---------------------------------------------------------------- */

describe("retry", () => {
  test("a validation failure is retried once and can then succeed", async () => {
    const provider = new FakeProvider([
      JSON.stringify({ ...JSON.parse(GOOD_REPLY), slogan: "far too many words in this slogan" }),
      GOOD_REPLY,
    ]);
    const result = await generateBrandWithRetry(provider, { userId: "usr_1", answers });
    assert.equal(result.strategy.name, "Luma");
    assert.equal(provider.calls.length, 2);
  });

  test("the retry nudges the model rather than repeating the same request", async () => {
    const provider = new FakeProvider(["nonsense", GOOD_REPLY]);
    await generateBrandWithRetry(provider, { userId: "usr_1", answers });
    assert.notEqual(provider.calls[0]!.user, provider.calls[1]!.user);
    assert.match(provider.calls[1]!.user, /regeneration #1/);
  });

  test("a bad brief is never retried — it would fail identically and cost money", async () => {
    const provider = new FakeProvider([GOOD_REPLY, GOOD_REPLY]);
    await assert.rejects(() =>
      generateBrandWithRetry(provider, { userId: "usr_1", answers: answers.slice(0, 1) }),
    );
    assert.equal(provider.calls.length, 0);
  });
});

/* --- Regeneration --------------------------------------------------------- */

describe("regenerating one element", () => {
  test("changes only the named field", async () => {
    const brief = buildBrief(answers);
    const current = parseStrategy(GOOD_REPLY, brief);
    const provider = new FakeProvider([JSON.stringify({ slogan: "Fresh from our oven." })]);

    const updated = await regenerateField(provider, brief, current, "slogan");
    assert.equal(updated.slogan, "Fresh from our oven.");
    assert.equal(updated.name, current.name, "the name is untouched");
    assert.equal(updated.brandStory, current.brandStory);
  });

  test("the prompt tells the model not to repeat itself", async () => {
    const brief = buildBrief(answers);
    const current = parseStrategy(GOOD_REPLY, brief);
    const provider = new FakeProvider([JSON.stringify({ slogan: "Something else." })]);
    await regenerateField(provider, brief, current, "slogan");
    assert.match(provider.calls[0]!.user, /meaningfully different/);
    assert.match(provider.calls[0]!.user, /Baked this morning\./);
  });

  test("a malformed regeneration is rejected rather than saved", async () => {
    const brief = buildBrief(answers);
    const current = parseStrategy(GOOD_REPLY, brief);
    const provider = new FakeProvider(["not json"]);
    await assert.rejects(() => regenerateField(provider, brief, current, "slogan"), BrandoraError);
  });
});
