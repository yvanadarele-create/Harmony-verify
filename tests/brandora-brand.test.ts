import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  INTERVIEW_QUESTIONS,
  assembleBrandProfile,
  brandContextPrompt,
  brandKitManifest,
  buildBrief,
  buildGuidelines,
  buildStrategyPrompt,
  contrastRatio,
  derivePalette,
  deriveTypography,
  extractJson,
  interviewProgress,
  meanHue,
  paletteIsAccessible,
  parseStrategy,
  questionFor,
  type BrandBrief,
  type InterviewAnswer,
} from "@brandora/brand-engine";
import { ValidationError, BrandoraError } from "@brandora/shared";

const answers: InterviewAnswer[] = [
  { field: "business", value: "A small bakery selling cookies from home" },
  { field: "product", value: "Cookies and small cakes" },
  { field: "audience", value: "Young professionals who order for the office" },
  { field: "positioning", value: "premium" },
  { field: "personality", value: ["elegant", "warm"] },
  { field: "differentiation", value: "Everything is baked the morning it is sold" },
  { field: "style", value: "Clean and minimal" },
];

const brief = (): BrandBrief => buildBrief(answers, "en");

/* --- §13-§15 The interview ----------------------------------------------- */

describe("brand interview", () => {
  test("every question offers a way through for someone who does not know", () => {
    for (const question of INTERVIEW_QUESTIONS) {
      assert.ok(question.helpPrompt.length > 0, `${question.field} has no help prompt`);
      assert.notEqual(
        question.helpPrompt,
        question.prompt,
        `${question.field}'s help just repeats the question`,
      );
    }
  });

  test("the help prompt avoids the jargon that blocked the user in the first place", () => {
    const positioning = questionFor("positioning");
    assert.match(positioning.prompt, /affordable, premium or luxury/i);
    assert.doesNotMatch(positioning.helpPrompt, /positioning/i);
  });

  test("a missing required answer names the question, not a field code", () => {
    const partial = answers.filter((a) => a.field !== "audience");
    assert.throws(
      () => buildBrief(partial),
      (err: unknown) => err instanceof ValidationError && /Who are your customers/.test(err.technicalDetail),
    );
  });

  test("optional questions can be skipped", () => {
    const withoutStyle = answers.filter((a) => a.field !== "style" && a.field !== "differentiation");
    const result = buildBrief(withoutStyle);
    assert.equal(result.style, "");
  });

  test("an unknown positioning is refused before it can reach a prompt", () => {
    const bad = answers.map((a) => (a.field === "positioning" ? { ...a, value: "fancy" } : a));
    assert.throws(() => buildBrief(bad), ValidationError);
  });

  test("answers taken via 'I don't know' are recorded as inferred", () => {
    const guessed = answers.map((a) =>
      a.field === "audience" ? { ...a, inferred: true } : a,
    );
    assert.deepEqual(buildBrief(guessed).inferredFields, ["audience"]);
  });

  test("progress reports the next unanswered question", () => {
    const progress = interviewProgress(answers.slice(0, 2));
    assert.equal(progress.answered, 2);
    assert.equal(progress.nextField, "audience");
  });
});

/* --- §18 Visual identity -------------------------------------------------- */

describe("visual identity", () => {
  test("hue averaging wraps correctly — bold and playful stay warm, not teal", () => {
    // Naive averaging of 355 and 35 gives 195 (a teal). The circular mean is 15.
    assert.ok(Math.abs(meanHue([355, 35]) - 15) < 1, `got ${meanHue([355, 35])}`);
  });

  test("every generated palette passes WCAG AA for text on its own surface", () => {
    const palette = derivePalette(brief());
    assert.ok(paletteIsAccessible(palette), "palette fails AA");
    const surface = palette.find((c) => c.role === "surface")!.hex;
    const ink = palette.find((c) => c.role === "ink")!.hex;
    assert.ok(contrastRatio(ink, surface) >= 7, "body text should clear AAA on the surface");
  });

  test("accessibility holds across every positioning and personality combination", () => {
    const positionings = ["affordable", "accessible-premium", "premium", "luxury", "contemporary", "mass-market"] as const;
    const traits = ["warm", "elegant", "bold", "natural", "playful", "trustworthy", "modern", "traditional"];
    for (const positioning of positionings) {
      for (const trait of traits) {
        const b = { ...brief(), positioning, personality: [trait] };
        assert.ok(
          paletteIsAccessible(derivePalette(b)),
          `${positioning} + ${trait} produced an inaccessible palette`,
        );
      }
    }
  });

  test("regenerating gives a genuinely different palette, not a random one", () => {
    const first = derivePalette(brief(), { variation: 0 });
    const second = derivePalette(brief(), { variation: 1 });
    const again = derivePalette(brief(), { variation: 1 });
    assert.notEqual(first[0]!.hex, second[0]!.hex, "regeneration should change the primary");
    assert.equal(second[0]!.hex, again[0]!.hex, "the same variation must be reproducible");
  });

  test("every swatch is a valid uppercase hex", () => {
    for (const swatch of derivePalette(brief())) {
      assert.match(swatch.hex, /^#[0-9A-F]{6}$/, `${swatch.name} is not a hex colour`);
    }
  });

  test("luxury gets a display serif; a plain affordable brand gets the cheap-to-load pairing", () => {
    assert.equal(deriveTypography({ ...brief(), positioning: "luxury" }).primary, "Cormorant Garamond");
    const plain = deriveTypography({ ...brief(), positioning: "affordable", personality: [] });
    assert.equal(plain.primary, "Inter");
  });

  test("the logo brief states a constraint, not just a vibe", () => {
    const b = brief();
    const profile = assembleBrandProfile("usr_1", b, strategy(), { now: new Date("2026-02-01") });
    assert.match(profile.logoBrief, /16px/, "must state the minimum legible size");
    assert.match(profile.logoBrief, /one colour/i, "must state the monochrome requirement");
    assert.match(profile.logoBrief, /baked the morning/i, "should draw on what makes the business different");
  });
});

/* --- §16 Strategy generation --------------------------------------------- */

const MODEL_REPLY = JSON.stringify({
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

function strategy() {
  return parseStrategy(MODEL_REPLY, brief());
}

describe("strategy generation", () => {
  test("the prompt carries the brief and asks for JSON only", () => {
    const prompt = buildStrategyPrompt(brief());
    assert.match(prompt.user, /Cookies and small cakes/);
    assert.match(prompt.user, /premium/);
    assert.match(prompt.system, /Return JSON only/);
  });

  test("an existing brand name is preserved rather than replaced", () => {
    const prompt = buildStrategyPrompt(brief(), { existingName: "Luma Cookies" });
    assert.match(prompt.user, /already called "Luma Cookies"/);
  });

  test("the founder's language reaches the prompt", () => {
    const french = buildStrategyPrompt({ ...brief(), locale: "fr" });
    assert.match(french.user, /in French/);
  });

  test("inferred answers are flagged so the model does not state them as fact", () => {
    const prompt = buildStrategyPrompt({ ...brief(), inferredFields: ["audience"] });
    assert.match(prompt.user, /could not answer/);
  });

  test("a well-formed reply parses into a strategy", () => {
    const result = strategy();
    assert.equal(result.name, "Luma");
    assert.equal(result.slogan, "Baked this morning.");
    assert.equal(result.nameAlternatives.length, 3);
  });

  test("code fences and preamble are recovered from", () => {
    const wrapped = "Here you go:\n```json\n" + MODEL_REPLY + "\n```";
    assert.equal(parseStrategy(wrapped, brief()).name, "Luma");
    assert.doesNotThrow(() => extractJson("```" + MODEL_REPLY + "```"));
  });

  test("the model cannot override the positioning the founder chose", () => {
    const hijack = JSON.parse(MODEL_REPLY);
    hijack.positioning = "luxury";
    const result = parseStrategy(JSON.stringify(hijack), brief());
    assert.equal(result.positioning, "premium", "the brief wins, not the model");
  });

  test("a missing field fails loudly instead of saving a half-built brand", () => {
    const broken = JSON.parse(MODEL_REPLY);
    delete broken.promise;
    assert.throws(() => parseStrategy(JSON.stringify(broken), brief()), ValidationError);
  });

  test("an over-long slogan is rejected", () => {
    const wordy = JSON.parse(MODEL_REPLY);
    wordy.slogan = "Baked this morning by hand in a very small kitchen";
    assert.throws(() => parseStrategy(JSON.stringify(wordy), brief()), ValidationError);
  });

  test("a reply that is not JSON at all surfaces as a brand-generation failure", () => {
    assert.throws(
      () => parseStrategy("I'm sorry, I can't help with that.", brief()),
      (err: unknown) => err instanceof BrandoraError && err.customerMessageKey === "brand.generation-failed",
    );
  });

  test("the customer never sees the model's raw failure", () => {
    try {
      parseStrategy("total nonsense", brief());
      assert.fail("should have thrown");
    } catch (err) {
      const error = err as BrandoraError;
      assert.doesNotMatch(error.toCustomerJSON().message, /JSON|model|nonsense/i);
    }
  });
});

/* --- §22 AI memory -------------------------------------------------------- */

describe("brand context for the assistant", () => {
  test("the assistant is told the brand's facts so it stops being generic", () => {
    const context = brandContextPrompt(strategy(), [{ name: "Primary", hex: "#4B167A" }]);
    assert.match(context, /Luma/);
    assert.match(context, /premium/);
    assert.match(context, /Young professionals/);
    assert.match(context, /#4B167A/);
    assert.match(context, /never ask for it again/i);
  });
});

/* --- §17, §19 Profile and kit -------------------------------------------- */

describe("brand profile and kit", () => {
  const profile = assembleBrandProfile("usr_1", brief(), strategy(), { now: new Date("2026-02-01T00:00:00Z") });

  test("the profile carries every field the schema names", () => {
    for (const field of [
      "name", "description", "industry", "targetCustomer", "positioning", "personality",
      "promise", "mission", "vision", "slogan", "toneOfVoice", "brandStory",
    ] as const) {
      assert.ok(profile[field], `${field} is empty`);
    }
    assert.equal(profile.status, "generated");
    assert.equal(profile.userId, "usr_1");
  });

  test("guidelines tell a printer what to do, in the printer's terms", () => {
    const guidelines = buildGuidelines(profile);
    assert.match(guidelines, /Clear space/);
    assert.match(guidelines, /Minimum size/);
    assert.match(guidelines, new RegExp(profile.palette[0]!.hex));
    assert.match(guidelines, /match to the hex/i);
  });

  test("the kit includes a monochrome logo, because embroidery and stamps need one", () => {
    const manifest = brandKitManifest(profile);
    assert.ok(manifest.some((e) => e.path.includes("monochrome")));
    assert.ok(manifest.some((e) => e.path.endsWith("palette.css")));
    assert.ok(manifest.some((e) => e.kind === "guidelines"));
  });

  test("the kit path is slugified so accented brand names still produce valid files", () => {
    const accented = assembleBrandProfile("usr_1", brief(), { ...strategy(), name: "Café Lumé" });
    const manifest = brandKitManifest(accented);
    assert.ok(manifest[0]!.path.startsWith("cafe-lume/"), manifest[0]!.path);
  });

  test("the CSS entry is pasteable as-is", () => {
    const css = brandKitManifest(profile).find((e) => e.path.endsWith("palette.css"))!.content!;
    assert.match(css, /:root \{/);
    assert.match(css, /--brand-primary: #[0-9A-F]{6};/);
  });
});
