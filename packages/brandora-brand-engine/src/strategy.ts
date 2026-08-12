/**
 * Brand strategy generation (§16).
 *
 * The words — name, promise, story, tone — are the one part of brand building
 * where a language model genuinely beats a rules engine, so this is where the
 * model is used. What this module owns is everything around the model: the
 * prompt, the contract the reply must satisfy, and the validation that stops a
 * malformed generation becoming a saved brand.
 *
 * The provider is an interface rather than an SDK import. That keeps the package
 * dependency-free and testable without a network, and it means swapping models —
 * or falling back when the API is down — is a constructor argument.
 */

import { type Positioning, POSITIONINGS, ValidationError, BrandoraError } from "@brandora/shared";
import type { BrandBrief } from "./interview.js";

export interface BrandStrategy {
  name: string;
  description: string;
  industry: string;
  targetCustomer: string;
  positioning: Positioning;
  personality: string[];
  promise: string;
  mission: string;
  vision: string;
  slogan: string;
  toneOfVoice: string;
  brandStory: string;
  /** Alternatives, so "regenerate the name" is instant rather than another call. */
  nameAlternatives: string[];
}

/** The fields a user can regenerate one at a time (§16). */
export const REGENERABLE_FIELDS = [
  "name",
  "description",
  "promise",
  "mission",
  "vision",
  "slogan",
  "toneOfVoice",
  "brandStory",
] as const;
export type RegenerableField = (typeof REGENERABLE_FIELDS)[number];

export interface StrategyProvider {
  /** Returns the model's raw text. Implementations must not parse or repair it. */
  complete(input: { system: string; user: string; maxTokens?: number }): Promise<string>;
}

/* --- Prompting ----------------------------------------------------------- */

const SYSTEM = `You are Brandora's brand strategist. You work with small business owners who are often building their first brand, frequently in West Africa, and who may be selling from home or through WhatsApp.

Rules:
- Write for the founder, not for a marketing department. Short sentences. No jargon.
- Never invent facts about the business beyond what the brief says.
- A slogan is at most six words.
- A brand name must be pronounceable in the founder's language, easy to spell after hearing it once, and must not be an existing well-known brand.
- Return JSON only. No commentary, no code fences.`;

/**
 * The reply contract, stated as a shape rather than prose.
 *
 * Models follow an example far more reliably than a description, and stating the
 * exact keys is what lets `parseStrategy` be strict instead of forgiving.
 */
const SHAPE = `{
  "name": string,
  "nameAlternatives": [string, string, string],
  "description": string,
  "industry": string,
  "targetCustomer": string,
  "promise": string,
  "mission": string,
  "vision": string,
  "slogan": string,
  "toneOfVoice": string,
  "brandStory": string
}`;

export interface PromptOptions {
  /** The founder already has a name and wants to keep it. */
  existingName?: string;
  /** Nudges the model away from its previous answer when regenerating. */
  variation?: number;
}

export function buildStrategyPrompt(
  brief: BrandBrief,
  options: PromptOptions = {},
): { system: string; user: string } {
  const language = { en: "English", fr: "French", es: "Spanish" }[brief.locale] ?? "English";

  const softened =
    brief.inferredFields.length > 0
      ? `\nThe founder could not answer these yet, so infer them gently and do not state them as facts: ${brief.inferredFields.join(", ")}.`
      : "";

  const naming = options.existingName
    ? `The brand is already called "${options.existingName}". Keep that name and return it unchanged; still supply three alternatives.`
    : "Propose a brand name, plus three alternatives.";

  const variation =
    options.variation && options.variation > 0
      ? `\nThis is regeneration #${options.variation}. Take a genuinely different angle from an obvious first answer.`
      : "";

  return {
    system: SYSTEM,
    user: `Write the brand strategy in ${language}.

BRIEF
Business: ${brief.business}
Sells: ${brief.product}
Customers: ${brief.audience}
Positioning: ${brief.positioning.replace("-", " ")}
Should feel: ${brief.personality.join(", ") || "not stated"}
Different because: ${brief.differentiation || "not stated"}
Visual style they imagine: ${brief.style || "not stated"}${softened}

${naming}${variation}

Return exactly this JSON shape:
${SHAPE}`,
  };
}

/**
 * Context for every later assistant turn (§22).
 *
 * This is the difference between "what packaging should I choose?" getting a
 * generic listicle and getting an answer that already knows the brand is premium,
 * elegant, deep purple, and sells to young professionals.
 */
export function brandContextPrompt(strategy: BrandStrategy, palette: readonly { name: string; hex: string }[] = []): string {
  const colours = palette.map((c) => `${c.name} ${c.hex}`).join(", ");
  return `You are Brandora's assistant, talking to the founder of ${strategy.name}.

What you already know — use it, never ask for it again:
- Sells: ${strategy.description}
- Industry: ${strategy.industry}
- Customers: ${strategy.targetCustomer}
- Positioning: ${strategy.positioning.replace("-", " ")}
- Personality: ${strategy.personality.join(", ")}
- Promise: ${strategy.promise}
- Tone of voice: ${strategy.toneOfVoice}${colours ? `\n- Colours: ${colours}` : ""}

Answer as their strategist. Recommend specifics, not categories: name the product, the quantity and the reason. If a recommendation depends on something you do not know, ask one question rather than hedging the whole answer.`;
}

/* --- Parsing ------------------------------------------------------------- */

/**
 * Pull the JSON object out of a model reply.
 *
 * Models add code fences and the occasional "Here's the strategy:" despite being
 * told not to. Recovering from that here is right — it is a formatting quirk, not
 * a content failure — but the recovery stops at the object boundary. Anything
 * beyond a fence or a preamble is a real failure and should surface as one.
 */
export function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new BrandoraError("brand.generation-failed", `no JSON object in model reply: ${raw.slice(0, 200)}`);
  }
  return body.slice(start, end + 1);
}

function str(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(key, `expected a non-empty string, got ${JSON.stringify(value)}`);
  }
  return value.trim();
}

function strList(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
}

const MAX_SLOGAN_WORDS = 6;

/**
 * Validate a model reply into a strategy.
 *
 * Positioning and personality are taken from the *brief*, not the reply. The
 * founder chose those; a model that decides a brand is luxury when the founder
 * said affordable has overridden a person, and every price and product
 * recommendation downstream would inherit the error.
 */
export function parseStrategy(raw: string, brief: BrandBrief): BrandStrategy {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (err) {
    throw new BrandoraError(
      "brand.generation-failed",
      `model reply was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new BrandoraError("brand.generation-failed", "model reply was not a JSON object");
  }
  const source = parsed as Record<string, unknown>;

  const slogan = str(source, "slogan");
  const words = slogan.split(/\s+/).filter(Boolean);
  if (words.length > MAX_SLOGAN_WORDS) {
    throw new ValidationError("slogan", `${words.length} words, the limit is ${MAX_SLOGAN_WORDS}`);
  }

  if (!(POSITIONINGS as readonly string[]).includes(brief.positioning)) {
    throw new ValidationError("positioning", `brief carries an unknown positioning ${brief.positioning}`);
  }

  return {
    name: str(source, "name"),
    nameAlternatives: strList(source, "nameAlternatives").slice(0, 5),
    description: str(source, "description"),
    industry: str(source, "industry"),
    targetCustomer: str(source, "targetCustomer"),
    positioning: brief.positioning,
    personality: brief.personality,
    promise: str(source, "promise"),
    mission: str(source, "mission"),
    vision: str(source, "vision"),
    slogan,
    toneOfVoice: str(source, "toneOfVoice"),
    brandStory: str(source, "brandStory"),
  };
}

/* --- Orchestration ------------------------------------------------------- */

export async function generateStrategy(
  brief: BrandBrief,
  provider: StrategyProvider,
  options: PromptOptions = {},
): Promise<BrandStrategy> {
  const prompt = buildStrategyPrompt(brief, options);
  const raw = await provider.complete({ ...prompt, maxTokens: 1600 });
  return parseStrategy(raw, brief);
}

/**
 * Regenerate a single element without redoing the brand (§16).
 *
 * Sends the current strategy along, with an explicit instruction not to repeat
 * it — otherwise a model asked for "another slogan" reliably returns the same
 * slogan with two words swapped.
 */
export function buildRegenerationPrompt(
  brief: BrandBrief,
  current: BrandStrategy,
  field: RegenerableField,
): { system: string; user: string } {
  const language = { en: "English", fr: "French", es: "Spanish" }[brief.locale] ?? "English";
  return {
    system: SYSTEM,
    user: `The brand "${current.name}" sells ${current.description} to ${current.targetCustomer}. Positioning: ${current.positioning.replace("-", " ")}. It should feel ${current.personality.join(", ")}.

Rewrite only the "${field}" field, in ${language}.
The current version is: "${String(current[field])}"
Return something meaningfully different, not a reworded version of it.

Return JSON only: {"${field}": string}`,
  };
}

export function parseRegeneration(raw: string, field: RegenerableField): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    throw new BrandoraError("brand.generation-failed", `regeneration of ${field} was not valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new BrandoraError("brand.generation-failed", `regeneration of ${field} was not an object`);
  }
  return str(parsed as Record<string, unknown>, field);
}
