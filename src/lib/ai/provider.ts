import { metrics } from "../infra/metrics";

// AI provider abstraction (Part 10: model management). No AI SDK is
// installed (no openai/@anthropic-ai/sdk/@google/generative-ai in
// package.json) and no API key exists in .env.example or render.yaml —
// same reasoning as the email/SMS providers in Phase 5: picking and paying
// for an LLM vendor, and deciding what CRM data is acceptable to send to a
// third-party API, are product/infra/privacy decisions, not something to
// introduce as a side effect of an architecture pass.
//
// Every AI feature in this phase (lead scoring, next-best-action, insights)
// that CAN work without an LLM (deterministic, explainable rules over
// existing data) does so today, for real. Features that genuinely need
// natural-language generation (email writing, prose summaries, the
// assistant) call through this interface, get NoopAIProvider's honest "not
// configured" result, and fall back to a structured (non-prose) result
// rather than fabricating AI output or silently doing nothing.
export type AIProviderName = "openai" | "anthropic" | "gemini" | "azure" | "local" | "none";

export interface AICompletionRequest {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AICompletionResult {
  success: boolean;
  text?: string;
  reason?: string;
  provider: AIProviderName;
  latencyMs: number;
}

export interface AIProvider {
  readonly name: AIProviderName;
  complete(request: AICompletionRequest): Promise<AICompletionResult>;
}

class NoopAIProvider implements AIProvider {
  readonly name: AIProviderName = "none";

  async complete(request: AICompletionRequest): Promise<AICompletionResult> {
    const startedAt = Date.now();
    console.log(`[ai:not-configured] prompt_length=${request.prompt.length} (no AI provider configured)`);
    return {
      success: false,
      reason: "No AI provider configured",
      provider: this.name,
      latencyMs: Date.now() - startedAt,
    };
  }
}

// Wraps any AIProvider with metrics tracking (Part 11), so every future
// real provider implementation gets ai.request/success/failure counted
// automatically just by being registered below — it doesn't need to
// remember to do this itself.
class MeteredAIProvider implements AIProvider {
  constructor(private inner: AIProvider) {}
  get name(): AIProviderName {
    return this.inner.name;
  }
  async complete(request: AICompletionRequest): Promise<AICompletionResult> {
    metrics.increment("ai.request");
    const result = await this.inner.complete(request);
    metrics.increment(result.success ? "ai.success" : "ai.failure");
    return result;
  }
}

// A registry keyed by provider name, so "no provider-specific code inside
// business logic" holds even once real providers exist: business logic
// calls `getActiveProvider()`, never a specific vendor class directly.
// Every entry maps to the same Noop instance today; adding a real OpenAI
// implementation later means adding one class and one line here.
const PROVIDERS: Record<AIProviderName, AIProvider> = {
  openai: new MeteredAIProvider(new NoopAIProvider()),
  anthropic: new MeteredAIProvider(new NoopAIProvider()),
  gemini: new MeteredAIProvider(new NoopAIProvider()),
  azure: new MeteredAIProvider(new NoopAIProvider()),
  local: new MeteredAIProvider(new NoopAIProvider()),
  none: new MeteredAIProvider(new NoopAIProvider()),
};

export function getProvider(name: AIProviderName): AIProvider {
  return PROVIDERS[name];
}
