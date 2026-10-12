// The models `npm run eval:candidates` compares. The best of them is made
// the service's default (PRD, "Stack").
//
// Each is a cheap, quick model that takes the call the service makes: a
// JSON Schema, a provider that keeps no prompts (ADR 12), and reasoning
// turned off (#57). A model whose reasoning cannot be turned off refuses
// that call, so it is not a candidate. On 12 October 2026 that ruled out
// Gemini 3.5 to 3.8 Flash, GPT-OSS and GLM 5.3.
//
// They are listed cheapest first, by OpenRouter's price on 12 October 2026
// for about 700 tokens in and 60 out, the size of a sort. A tie in the
// scores goes to the cheaper model. The default model is always one of
// them, so each run measures it too.
export const candidates = [
  "google/gemma-4-31b-it",
  "anthropic/claude-haiku-5.5",
  "qwen/qwen3.5-35b-a3b",
  "xiaomi/mimo-v2.6-flash",
  "deepseek/deepseek-v4.1-flash",
  "google/gemini-3.1-flash-lite",
  "mistralai/mistral-large-4-0",
];
