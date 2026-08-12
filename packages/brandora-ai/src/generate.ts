/**
 * The brand generation flow (§16, Phase 3).
 *
 *   interview answers → brief → AI → validation → strategy → identity
 *
 * The ordering matters and is enforced here rather than left to a route
 * handler. Validation sits between the model and the domain, so a malformed
 * generation never becomes a saved brand: `parseStrategy` rejects bad JSON,
 * missing fields, an over-long slogan, and — critically — a positioning the
 * model tried to change out from under the founder.
 *
 * Everything after validation is deterministic. The palette, typography and
 * logo brief are derived from the brief and the validated strategy, so a
 * regeneration of the words does not silently reshuffle the colours.
 */

import { type BrandProfile, BrandoraError } from "@brandora/shared";
import {
  type BrandBrief,
  type BrandStrategy,
  type InterviewAnswer,
  type RegenerableField,
  type StrategyProvider,
  assembleBrandProfile,
  buildBrief,
  buildRegenerationPrompt,
  generateStrategy,
  parseRegeneration,
} from "@brandora/brand-engine";

export interface GenerateInput {
  userId: string;
  answers: readonly InterviewAnswer[];
  locale?: string;
  /** The founder already has a name and wants to keep it. */
  existingName?: string;
  /** Increment for a genuinely different generation. */
  variation?: number;
  brandId?: string;
  now?: Date;
}

export interface GenerateResult {
  profile: BrandProfile;
  strategy: BrandStrategy;
  brief: BrandBrief;
  /** The validated model output, stored so a strategy can be audited later. */
  raw: BrandStrategy;
}

/**
 * Run the whole flow.
 *
 * Note what is *not* caught here: a `ValidationError` from `buildBrief` means
 * the interview is incomplete, which is the caller's fault and should surface
 * as a 400 rather than being retried against a paid API.
 */
export async function generateBrand(
  provider: StrategyProvider,
  input: GenerateInput,
): Promise<GenerateResult> {
  const brief = buildBrief(input.answers, input.locale ?? "en");

  const strategy = await generateStrategy(brief, provider, {
    existingName: input.existingName,
    variation: input.variation,
  });

  const profile = assembleBrandProfile(input.userId, brief, strategy, {
    variation: input.variation ?? 0,
    brandId: input.brandId,
    now: input.now,
  });

  return { profile, strategy, brief, raw: strategy };
}

/**
 * Regenerate one written element (§16).
 *
 * Only the named field changes; the palette and typography are untouched,
 * because a founder asking for a different slogan has not asked for a different
 * colour scheme.
 */
export async function regenerateField(
  provider: StrategyProvider,
  brief: BrandBrief,
  current: BrandStrategy,
  field: RegenerableField,
): Promise<BrandStrategy> {
  const prompt = buildRegenerationPrompt(brief, current, field);
  const raw = await provider.complete({ ...prompt, maxTokens: 1_000 });
  const value = parseRegeneration(raw, field);
  return { ...current, [field]: value };
}

/**
 * Retry a generation whose *validation* failed.
 *
 * A model that returns a nine-word slogan on the first attempt usually returns
 * a six-word one on the second, so one retry converts a visible failure into a
 * slightly slower success. Transport failures are not retried here — the SDK
 * already does that, and retrying a rate limit in two places multiplies the
 * wait a founder sits through.
 */
export async function generateBrandWithRetry(
  provider: StrategyProvider,
  input: GenerateInput,
  attempts = 2,
): Promise<GenerateResult> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await generateBrand(provider, {
        ...input,
        // Nudge the model off the answer that just failed validation.
        variation: (input.variation ?? 0) + attempt,
      });
    } catch (err) {
      lastError = err;
      const retryable =
        err instanceof BrandoraError &&
        (err.name === "ValidationError" || err.customerMessageKey === "brand.generation-failed");
      if (!retryable) throw err;
    }
  }

  throw lastError;
}
