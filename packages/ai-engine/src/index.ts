import type { Complexity, RiskLevel, Specialty, VerificationAnalysis } from "@harmony/shared";

/**
 * Optional AI refinement over the deterministic rules in @harmony/verification-engine.
 *
 * The contract is deliberate: rules run first and always produce a usable analysis;
 * this layer may only *adjust* that result. If the model is unavailable, slow, or
 * returns something malformed, triage still happens. A verification platform that
 * stops working when an LLM has an outage is not infrastructure.
 */

export interface AiSuggestion {
  specialty?: Specialty;
  complexity?: Complexity;
  risk?: RiskLevel;
  /** 0–1. Suggestions below the acceptance threshold are recorded but not applied. */
  confidence: number;
  notes?: string;
}

export interface AiProvider {
  /** Must resolve, or reject quickly — never hang. */
  suggest(input: { content: string; baseline: VerificationAnalysis }): Promise<AiSuggestion>;
  readonly name: string;
}

export interface RefineOptions {
  /** Below this, a suggestion is logged but never applied. */
  acceptThreshold?: number;
  /** Hard ceiling on how long the model may delay triage. */
  timeoutMs?: number;
}

export interface RefineResult {
  analysis: VerificationAnalysis;
  applied: boolean;
  /** Appended to the analysis rationale so the audit trail shows AI involvement. */
  note: string;
}

const DEFAULTS = { acceptThreshold: 0.8, timeoutMs: 4_000 } as const;

const RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

/**
 * Applies a provider's suggestion to a baseline analysis under strict rules.
 *
 * The asymmetry here is intentional. The model may **raise** risk or complexity —
 * being too careful costs money, and that is the cheaper error. It may never
 * **lower** them, because a model talking the platform out of caution is precisely
 * the failure this company exists to prevent.
 */
export async function refineAnalysis(
  content: string,
  baseline: VerificationAnalysis,
  provider: AiProvider | null,
  options: RefineOptions = {},
): Promise<RefineResult> {
  const { acceptThreshold, timeoutMs } = { ...DEFAULTS, ...options };

  if (!provider) {
    return { analysis: baseline, applied: false, note: "Deterministic rules only; no AI provider configured." };
  }

  let suggestion: AiSuggestion;
  try {
    suggestion = await withTimeout(provider.suggest({ content, baseline }), timeoutMs);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return {
      analysis: baseline,
      applied: false,
      note: `AI refinement skipped (${provider.name}: ${why}). Deterministic result retained.`,
    };
  }

  if (!isValidSuggestion(suggestion)) {
    return {
      analysis: baseline,
      applied: false,
      note: `AI response from ${provider.name} was malformed and was discarded.`,
    };
  }

  if (suggestion.confidence < acceptThreshold) {
    return {
      analysis: baseline,
      applied: false,
      note:
        `AI suggestion from ${provider.name} recorded at confidence ` +
        `${suggestion.confidence.toFixed(2)}, below the ${acceptThreshold} threshold. Not applied.`,
    };
  }

  const changes: string[] = [];
  const next: VerificationAnalysis = { ...baseline, rationale: [...baseline.rationale] };

  if (suggestion.risk && RANK[suggestion.risk]! > RANK[baseline.risk]!) {
    next.risk = suggestion.risk;
    changes.push(`risk raised ${baseline.risk} → ${suggestion.risk}`);
  }
  if (suggestion.complexity && RANK[suggestion.complexity]! > RANK[baseline.complexity]!) {
    next.complexity = suggestion.complexity;
    changes.push(`complexity raised ${baseline.complexity} → ${suggestion.complexity}`);
  }

  // A specialty change re-routes the case, so it is only accepted where the rules
  // had no opinion — never as an override of a customer's explicit choice.
  if (suggestion.specialty && baseline.specialty === "other" && suggestion.specialty !== "other") {
    next.specialty = suggestion.specialty;
    next.recommendedExpert = { ...baseline.recommendedExpert, specialty: suggestion.specialty };
    changes.push(`specialty resolved to ${suggestion.specialty}`);
  }

  if (changes.length === 0) {
    return {
      analysis: baseline,
      applied: false,
      note: `AI review by ${provider.name} agreed with the deterministic result.`,
    };
  }

  // Raising risk must tighten reviewer requirements too, or the escalation is cosmetic.
  if (next.risk === "high" || next.complexity === "high") {
    next.recommendedExpert = {
      ...next.recommendedExpert,
      minYearsExperience: Math.max(next.recommendedExpert.minYearsExperience, 10),
      minRating: Math.max(next.recommendedExpert.minRating, 4.5),
    };
  }

  const note =
    `AI refinement by ${provider.name} (confidence ${suggestion.confidence.toFixed(2)}): ` +
    `${changes.join("; ")}.` +
    (suggestion.notes ? ` ${suggestion.notes}` : "");
  next.rationale.push(note);

  return { analysis: next, applied: true, note };
}

function isValidSuggestion(s: unknown): s is AiSuggestion {
  if (typeof s !== "object" || s === null) return false;
  const v = s as Record<string, unknown>;
  if (typeof v["confidence"] !== "number" || !Number.isFinite(v["confidence"])) return false;
  if (v["confidence"] < 0 || v["confidence"] > 1) return false;
  const levels = ["low", "medium", "high"];
  if (v["risk"] !== undefined && !levels.includes(String(v["risk"]))) return false;
  if (v["complexity"] !== undefined && !levels.includes(String(v["complexity"]))) return false;
  return true;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))); },
    );
  });
}

/** Deterministic provider for tests and local development. */
export class StubProvider implements AiProvider {
  readonly name = "stub";
  constructor(private readonly reply: AiSuggestion | (() => Promise<AiSuggestion>)) {}

  async suggest(): Promise<AiSuggestion> {
    return typeof this.reply === "function" ? this.reply() : this.reply;
  }
}
