// Each must take the service's call: a JSON Schema, a provider that keeps
// no prompts (ADR 12), and reasoning turned off. On 12 October 2026 that
// ruled out Gemini 3.5 to 3.8 Flash, GPT-OSS and GLM 5.3.
//
// Cheapest first, by OpenRouter's price on 12 October 2026 for a sort's
// size, because a tie in the scores goes to the model listed first.
export const candidates = [
  "google/gemma-4-31b-it",
  "anthropic/claude-haiku-5.5",
  "qwen/qwen3.5-35b-a3b",
  "xiaomi/mimo-v2.6-flash",
  "deepseek/deepseek-v4.1-flash",
  "google/gemini-3.1-flash-lite",
  "mistralai/mistral-large-4-0",
];
