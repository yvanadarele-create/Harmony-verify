/**
 * The AI provider — the one place Brandora talks to a language model.
 *
 * `@brandora/brand-engine` defines the prompt, the reply contract and the
 * validation; this package is only the transport. That split is what makes the
 * brand engine testable without a network and this module replaceable without
 * touching a single rule about what a brand strategy is.
 *
 * Security (§29, §61):
 *   - `ANTHROPIC_API_KEY` is read by `@brandora/config` from the environment and
 *     never leaves this process. This module is server-side only; there is no
 *     browser build and nothing here may be imported from client code.
 *   - No key, no header and no request body ever appears in a thrown message.
 *     The customer sees a sentence; the admin sees the model's error class and
 *     status, already redacted.
 *   - The *customer's* interview answers are the only user content sent. No
 *     credential, no other customer's data, and no supplier cost is ever placed
 *     in a prompt.
 */

import Anthropic from "@anthropic-ai/sdk";
import { BrandoraError, toBrandoraError } from "@brandora/shared";
import { anthropicApiKey, anthropicModel } from "@brandora/config";
import type { StrategyProvider } from "@brandora/brand-engine";

export interface ProviderOptions {
  /** Injected in tests; read from the environment in production. */
  apiKey?: string;
  model?: string;
  /**
   * How long one generation may take. Brand strategy is a foreground request
   * behind a loading screen — a founder staring at "Building your brand…" for
   * two minutes has already decided the product is broken.
   */
  timeoutMs?: number;
  maxRetries?: number;
  /** Reports technical detail to the admin channel. Never to a customer. */
  onError?: (detail: string) => void;
  /** Structured operation log (§19). Never receives credentials. */
  onLog?: (entry: AiLogEntry) => void;
}

export interface AiLogEntry {
  requestId: string;
  operation: string;
  status: "ok" | "error";
  durationMs: number;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  /** A category, not a message — categories aggregate, messages do not. */
  errorCategory?: string;
}

/**
 * Default output ceiling.
 *
 * Deliberately generous, because on this model `max_tokens` caps thinking *and*
 * the reply together. A limit sized to the JSON alone truncates the answer
 * mid-object, and a truncated reply fails validation in a way that looks like a
 * model problem rather than a configuration one.
 */
const DEFAULT_MAX_TOKENS = 8_000;

const DEFAULT_TIMEOUT_MS = 90_000;

export class AnthropicStrategyProvider implements StrategyProvider {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly onError?: (detail: string) => void;
  private readonly onLog?: (entry: AiLogEntry) => void;

  constructor(options: ProviderOptions = {}) {
    this.model = options.model ?? anthropicModel();
    this.onError = options.onError;
    this.onLog = options.onLog;

    this.client = new Anthropic({
      apiKey: options.apiKey ?? anthropicApiKey(),
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      // The SDK already retries 429 and 5xx with exponential backoff. Rolling
      // our own on top would multiply the wait a founder sits through.
      maxRetries: options.maxRetries ?? 2,
    });
  }

  async complete(input: { system: string; user: string; maxTokens?: number }): Promise<string> {
    const requestId = `ai_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = Date.now();

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: input.system,
        messages: [{ role: "user", content: input.user }],
      });

      // Check the stop reason *before* reading content. A refusal returns a
      // successful HTTP 200 with an empty or partial content array, so code
      // that indexes content[0] unconditionally throws a TypeError here and
      // reports it as a crash rather than as what it is.
      if (response.stop_reason === "refusal") {
        // `stop_details` carries the policy category. It is newer than the
        // pinned SDK's typings, so it is read defensively rather than pinned to
        // a shape that would break the build on the next SDK bump — and it is
        // only ever used for the admin-facing detail string.
        const category = refusalCategory(response);
        this.log({
          requestId,
          operation: "brand-strategy",
          status: "error",
          durationMs: Date.now() - startedAt,
          model: this.model,
          errorCategory: "refusal",
        });
        throw new BrandoraError(
          "brand.generation-failed",
          `model declined the request (${category ?? "no category"})`,
          502,
        );
      }

      if (response.stop_reason === "max_tokens") {
        // The reply is cut off, so it will not parse. Failing here names the
        // real cause; letting it reach the JSON parser blames the model.
        throw new BrandoraError(
          "brand.generation-failed",
          `reply truncated at the ${input.maxTokens ?? DEFAULT_MAX_TOKENS} token ceiling`,
          502,
        );
      }

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");

      if (text.trim() === "") {
        throw new BrandoraError("brand.generation-failed", "model returned no text content", 502);
      }

      this.log({
        requestId,
        operation: "brand-strategy",
        status: "ok",
        durationMs: Date.now() - startedAt,
        model: this.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      });

      return text;
    } catch (err) {
      const error = this.translate(err);
      this.onError?.(`ai ${requestId}: ${error.technicalDetail}`);
      this.log({
        requestId,
        operation: "brand-strategy",
        status: "error",
        durationMs: Date.now() - startedAt,
        model: this.model,
        errorCategory: categorise(err),
      });
      throw error;
    }
  }

  /**
   * Turn an SDK error into a Brandora one.
   *
   * Uses the SDK's typed error classes rather than matching on message text —
   * message wording changes between releases, status codes do not. Every branch
   * lands on the same customer-facing sentence; only the admin detail differs,
   * because "the AI is rate limited" and "our key is invalid" need different
   * people to do different things.
   */
  private translate(err: unknown): BrandoraError {
    if (err instanceof BrandoraError) return err;

    if (err instanceof Anthropic.AuthenticationError) {
      return new BrandoraError(
        "brand.generation-failed",
        "ANTHROPIC_API_KEY is missing, revoked or invalid — check the deployment's environment settings",
        500,
      );
    }
    if (err instanceof Anthropic.PermissionDeniedError) {
      return new BrandoraError(
        "brand.generation-failed",
        "the API key lacks access to this model",
        500,
      );
    }
    if (err instanceof Anthropic.RateLimitError) {
      return new BrandoraError(
        "rate.limited",
        "the AI provider rate limited Brandora; the SDK already retried",
        429,
      );
    }
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
      return new BrandoraError("brand.generation-failed", "generation timed out", 504);
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return new BrandoraError("brand.generation-failed", "could not reach the AI provider", 502);
    }
    if (err instanceof Anthropic.APIError) {
      return new BrandoraError(
        "brand.generation-failed",
        `AI provider returned ${err.status ?? "an error"} (${err.name})`,
        502,
      );
    }
    return toBrandoraError(err, "brand.generation-failed");
  }

  private log(entry: AiLogEntry): void {
    this.onLog?.(entry);
  }
}

/**
 * Read the refusal category without depending on the SDK's typings for it.
 *
 * The field is documented and populated by the API; the installed SDK version
 * does not type it yet. A narrow structural read keeps the build stable across
 * SDK upgrades in both directions, and the value only ever reaches an admin log.
 */
function refusalCategory(response: unknown): string | undefined {
  if (typeof response !== "object" || response === null) return undefined;
  const details = (response as { stop_details?: unknown }).stop_details;
  if (typeof details !== "object" || details === null) return undefined;
  const category = (details as { category?: unknown }).category;
  return typeof category === "string" ? category : undefined;
}

function categorise(err: unknown): string {
  if (err instanceof BrandoraError) return err.customerMessageKey;
  if (err instanceof Anthropic.AuthenticationError) return "auth";
  if (err instanceof Anthropic.RateLimitError) return "rate-limit";
  if (err instanceof Anthropic.APIConnectionTimeoutError) return "timeout";
  if (err instanceof Anthropic.APIConnectionError) return "connection";
  if (err instanceof Anthropic.APIError) return `http-${err.status ?? "unknown"}`;
  return "unknown";
}

/**
 * Stand-in for when no API key is configured.
 *
 * It does not fabricate a brand. §"no fake AI responses in production" is the
 * rule, and a provider that invents a plausible name and story is precisely the
 * thing that makes a demo look finished and a launch fail. It fails with the
 * same customer-facing message as any other generation failure, and an admin
 * detail that says exactly what is missing.
 */
export class UnconfiguredStrategyProvider implements StrategyProvider {
  async complete(): Promise<string> {
    throw new BrandoraError(
      "brand.generation-failed",
      "no AI provider is configured — set ANTHROPIC_API_KEY in the deployment environment",
      503,
    );
  }
}
