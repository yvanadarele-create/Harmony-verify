/**
 * The brand interview.
 *
 * The premise of §13 is that a user arrives *without* a brand. That makes the
 * interview the front door of the whole product, and it has one hard
 * requirement: nobody gets stuck. Every question carries an "I don't know —
 * help me" path (§15), and the help is not a definition of the jargon — it is a
 * different, concrete question the person can actually answer.
 *
 * "What is your positioning?" defeats a first-time founder. "If a customer saw
 * your price next to a supermarket's, should yours look cheaper, similar, or
 * clearly better?" does not.
 */

import { type Positioning, POSITIONINGS, ValidationError } from "@brandora/shared";

export const INTERVIEW_FIELDS = [
  "business",
  "product",
  "audience",
  "positioning",
  "personality",
  "differentiation",
  "style",
] as const;
export type InterviewField = (typeof INTERVIEW_FIELDS)[number];

export interface InterviewOption {
  value: string;
  label: string;
  /** Plain-language gloss, shown under the option. */
  hint: string;
}

export interface InterviewQuestion {
  field: InterviewField;
  /** The question as asked. */
  prompt: string;
  /** Why Brandora is asking — shown small, builds trust rather than mystery. */
  because: string;
  /**
   * The fallback when the user taps "I don't know — help me": an easier question
   * that gets at the same thing sideways.
   */
  helpPrompt: string;
  /** Worked examples. Concrete beats abstract for someone facing a blank field. */
  examples: string[];
  kind: "text" | "choice" | "multi";
  options?: InterviewOption[];
  /** A question can be skipped when the AI can infer it from the rest. */
  required: boolean;
}

export const INTERVIEW_QUESTIONS: readonly InterviewQuestion[] = [
  {
    field: "business",
    prompt: "What are you building?",
    because: "Everything else follows from this. One sentence is plenty.",
    helpPrompt:
      "Forget the word 'business' for a second. If a friend asked what you're working on, what would you say?",
    examples: [
      "A small bakery selling cookies from home",
      "A natural skincare line for dry skin",
      "A tailoring service for office wear",
    ],
    kind: "text",
    required: true,
  },
  {
    field: "product",
    prompt: "What do you sell?",
    because: "This decides which packaging and products Brandora sources for you.",
    helpPrompt: "What would the first thing a customer buys from you be?",
    examples: ["Cookies and small cakes", "Face oil and body butter", "Shirts and trousers"],
    kind: "text",
    required: true,
  },
  {
    field: "audience",
    prompt: "Who are your customers?",
    because: "A brand that speaks to everyone speaks to nobody.",
    helpPrompt:
      "Picture the last person who bought from you, or the person you'd most like to. Who are they?",
    examples: [
      "Young professionals who order for the office",
      "Mothers buying for their family",
      "Students who want something affordable",
    ],
    kind: "text",
    required: true,
  },
  {
    field: "positioning",
    prompt: "Should your brand feel affordable, premium or luxury?",
    because: "This sets your prices, your packaging and how your logo should look.",
    helpPrompt:
      "If a customer saw your price next to a supermarket's, should yours look cheaper, about the same, or clearly better?",
    examples: [],
    kind: "choice",
    options: [
      { value: "affordable", label: "Affordable", hint: "Best price wins. Simple, honest, everyday." },
      {
        value: "accessible-premium",
        label: "Accessible premium",
        hint: "Feels special, priced so ordinary people can still buy it.",
      },
      { value: "premium", label: "Premium", hint: "Quality first. Customers pay more, and know why." },
      { value: "luxury", label: "Luxury", hint: "Rare, crafted, exclusive. Price is not the point." },
      {
        value: "contemporary",
        label: "Contemporary",
        hint: "Current and design-led. Follows what people want now.",
      },
      { value: "mass-market", label: "Mass market", hint: "Made for volume. Familiar and easy to reach." },
    ],
    required: true,
  },
  {
    field: "personality",
    prompt: "What should customers feel when they see your brand?",
    because: "This becomes your colours, your typography and your tone of voice.",
    helpPrompt: "Pick the words that feel right. There is no wrong answer here.",
    examples: [],
    kind: "multi",
    options: [
      { value: "warm", label: "Warm", hint: "Welcoming, human, close" },
      { value: "elegant", label: "Elegant", hint: "Refined and quiet" },
      { value: "bold", label: "Bold", hint: "Confident and loud" },
      { value: "natural", label: "Natural", hint: "Honest, earthy, unprocessed" },
      { value: "playful", label: "Playful", hint: "Light, fun, easy" },
      { value: "trustworthy", label: "Trustworthy", hint: "Solid, dependable, safe" },
      { value: "modern", label: "Modern", hint: "Clean and current" },
      { value: "traditional", label: "Traditional", hint: "Rooted, proven, familiar" },
    ],
    required: true,
  },
  {
    field: "differentiation",
    prompt: "What makes your business different?",
    because: "This becomes your brand promise — the reason someone chooses you twice.",
    helpPrompt:
      "What do customers tell you they like? Or: what would you refuse to change, even if it were cheaper?",
    examples: [
      "Everything is made the same morning it's sold",
      "I use only shea butter sourced from one cooperative",
      "I deliver the same day, anywhere in the city",
    ],
    kind: "text",
    required: false,
  },
  {
    field: "style",
    prompt: "What visual style do you imagine?",
    because: "It points the logo and packaging in the right direction from the start.",
    helpPrompt:
      "Don't describe a design — name a brand, a shop or a place whose look you like, and we'll take it from there.",
    examples: ["Clean and minimal", "Colourful and lively", "Earthy and handmade"],
    kind: "text",
    required: false,
  },
] as const;

export function questionFor(field: InterviewField): InterviewQuestion {
  const found = INTERVIEW_QUESTIONS.find((q) => q.field === field);
  if (!found) throw new ValidationError("field", `unknown interview field ${field}`);
  return found;
}

export interface InterviewAnswer {
  field: InterviewField;
  /** Free text, a single option value, or several for a `multi` question. */
  value: string | string[];
  /**
   * True when the user took the "I don't know" path. Kept on the record rather
   * than thrown away: the AI should treat an inferred answer as softer evidence
   * than something the founder actually told us, and the interface can offer to
   * revisit it later.
   */
  inferred?: boolean;
}

/** The structured result of the interview — what strategy generation works from. */
export interface BrandBrief {
  business: string;
  product: string;
  audience: string;
  positioning: Positioning;
  personality: string[];
  differentiation: string;
  style: string;
  /** Fields the user could not answer, so downstream copy can hedge honestly. */
  inferredFields: InterviewField[];
  locale: string;
}

const asText = (value: string | string[]): string =>
  Array.isArray(value) ? value.join(", ") : value.trim();

const asList = (value: string | string[]): string[] =>
  (Array.isArray(value) ? value : value.split(","))
    .map((v) => v.trim())
    .filter(Boolean);

function isPositioning(value: string): value is Positioning {
  return (POSITIONINGS as readonly string[]).includes(value);
}

/**
 * Fold answers into a brief, validating as it goes.
 *
 * Validation happens here rather than at the API edge because this is the last
 * point where a bad answer is still cheap: past it, a malformed positioning
 * becomes a prompt, a generation, a palette and a logo before anyone notices.
 */
export function buildBrief(answers: readonly InterviewAnswer[], locale = "en"): BrandBrief {
  const byField = new Map<InterviewField, InterviewAnswer>();
  for (const answer of answers) byField.set(answer.field, answer);

  for (const question of INTERVIEW_QUESTIONS) {
    if (!question.required) continue;
    const answer = byField.get(question.field);
    const empty =
      !answer ||
      (Array.isArray(answer.value) ? answer.value.length === 0 : answer.value.trim() === "");
    if (empty) {
      throw new ValidationError(question.field, `"${question.prompt}" has no answer`);
    }
  }

  const positioningRaw = asText(byField.get("positioning")?.value ?? "");
  if (!isPositioning(positioningRaw)) {
    throw new ValidationError(
      "positioning",
      `expected one of ${POSITIONINGS.join(", ")}, got "${positioningRaw}"`,
    );
  }

  const inferredFields = INTERVIEW_QUESTIONS.filter((q) => byField.get(q.field)?.inferred).map(
    (q) => q.field,
  );

  return {
    business: asText(byField.get("business")?.value ?? ""),
    product: asText(byField.get("product")?.value ?? ""),
    audience: asText(byField.get("audience")?.value ?? ""),
    positioning: positioningRaw,
    personality: asList(byField.get("personality")?.value ?? []),
    differentiation: asText(byField.get("differentiation")?.value ?? ""),
    style: asText(byField.get("style")?.value ?? ""),
    inferredFields,
    locale,
  };
}

/** How far through the interview the user is, for the progress indicator. */
export function interviewProgress(answers: readonly InterviewAnswer[]): {
  answered: number;
  total: number;
  nextField: InterviewField | null;
} {
  const answered = new Set(answers.map((a) => a.field));
  const next = INTERVIEW_QUESTIONS.find((q) => !answered.has(q.field));
  return {
    answered: answered.size,
    total: INTERVIEW_QUESTIONS.length,
    nextField: next?.field ?? null,
  };
}
