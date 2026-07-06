import { getProvider, type AIProvider, type AIProviderName } from "./provider";

// Which provider is "active" is an env var, not a hardcoded value — same
// as every other environment-driven config in this app. It defaults to
// "none" (the Noop provider) since no AI_PROVIDER env var exists in
// .env.example or render.yaml today; setting one there later, alongside
// the corresponding API key, is how a real provider gets activated
// without any code change.
export function getActiveProviderName(): AIProviderName {
  const configured = process.env.AI_PROVIDER as AIProviderName | undefined;
  const valid: AIProviderName[] = ["openai", "anthropic", "gemini", "azure", "local", "none"];
  return configured && valid.includes(configured) ? configured : "none";
}

export function getActiveProvider(): AIProvider {
  return getProvider(getActiveProviderName());
}

export function isAIEnabled(): boolean {
  return getActiveProviderName() !== "none";
}
