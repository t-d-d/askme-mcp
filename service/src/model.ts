// The service reaches the model only through createCountedModel (ADR 21).
// The eval uses createModel, on its own key, outside the cap.
import { z } from "zod";
import type { AccountId } from "./identity";
import { rateLimits, windowOf } from "./rate";
import type { Store } from "./store/store";

// The best of the candidates in evals/scores.md. Changing it needs a run of
// the eval before and after.
export const defaultModel = "anthropic/claude-haiku-5.5";

export const openRouterEndpoint = "https://openrouter.ai/api/v1";

// reply is the model's earlier answer, as the JSON text it gave.
export interface FollowUp {
  reply: string;
  user: string;
}

export interface ModelRequest {
  system: string;
  user: string;
  followUp?: FollowUp;
  schemaName: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  timeoutMs: number;
}

// reason is logged, so it never holds the reply's content.
export class ModelFailed extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`The model gave no reply: ${reason}.`);
    this.name = "ModelFailed";
    this.reason = reason;
  }
}

// Failures of askme's own key or settings, which alert. OpenRouter answers
// 401 for a refused key, 402 for spent credit, and 404 for a withdrawn model
// or when no provider meets the routing. A 403 is its moderation too, which
// a hostile ask can trip, so only a 403 for a spent budget counts. A 400 can
// come from the ask's text, so it does not count either.
const ourFaults = new Set([
  "status-401",
  "status-402",
  "status-403-budget",
  "status-404",
]);

export const modelFaultIsOurs = (reason: string): boolean =>
  ourFaults.has(reason);

// OpenRouter refuses a call over the key's own limit, or over a budget set
// on its account, with a 403 naming the limit.
const budgetRefusal = z.object({
  error: z.object({
    metadata: z.object({
      limit_source: z.enum([
        "openrouter_key_limit",
        "openrouter_guardrail_budget",
        "openrouter_workspace_budget",
      ]),
    }),
  }),
});

export interface Model {
  reply(request: ModelRequest): Promise<unknown>;
}

// The cap working as designed, not a failure of the model or of askme.
export class CapReached extends Error {
  readonly resetsAt: Date;
  constructor(resetsAt: Date) {
    super("The account's daily cap on model calls is spent.");
    this.name = "CapReached";
    this.resetsAt = resetsAt;
  }
}

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const completionSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string() }) }))
    .min(1),
});

export function createModel(config: {
  endpoint: string;
  model: string;
  // Undefined sends no key, as in a cloud session, where the key is added
  // after the request leaves the session.
  key: () => Promise<string | undefined>;
  fetch?: Fetch;
}): Model {
  const send = config.fetch ?? fetch;
  return {
    async reply(request) {
      // The time limit covers reading the key too. A key that cannot be
      // read is askme's own failure, so its error is not wrapped.
      const signal = AbortSignal.timeout(request.timeoutMs);
      const key = await config.key();
      if (signal.aborted) throw new ModelFailed("timeout");
      let answer: Response;
      let body: unknown;
      try {
        answer = await send(`${config.endpoint}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(key === undefined ? {} : { authorization: `Bearer ${key}` }),
          },
          body: JSON.stringify({
            model: config.model,
            messages: [
              { role: "system", content: request.system },
              { role: "user", content: request.user },
              ...(request.followUp === undefined
                ? []
                : [
                    { role: "assistant", content: request.followUp.reply },
                    { role: "user", content: request.followUp.user },
                  ]),
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: request.schemaName,
                strict: true,
                schema: request.schema,
              },
            },
            // Only providers that keep no prompts (ADR 12). No temperature
            // is sent: with require_parameters, OpenRouter would refuse the
            // call, as no endpoint for the default model takes one.
            provider: {
              data_collection: "deny",
              zdr: true,
              require_parameters: true,
            },
            // The provider counts thinking tokens against max_tokens, so a
            // model that thinks first can run out before its reply.
            reasoning: { enabled: false },
            max_tokens: request.maxTokens,
          }),
          signal,
        });
        if (answer.status === 403) {
          // A body that is not JSON is a plain 403. A timeout stays one.
          const refusal: unknown = await answer // eslint-disable-line no-restricted-syntax -- this module is where a model's answer is read
            .json()
            .catch((error: unknown) => {
              if (error instanceof SyntaxError) return undefined;
              throw error;
            });
          throw new ModelFailed(
            budgetRefusal.safeParse(refusal).success
              ? "status-403-budget"
              : "status-403",
          );
        }
        if (!answer.ok)
          throw new ModelFailed(`status-${String(answer.status)}`);
        body = await answer.json(); // eslint-disable-line no-restricted-syntax -- this module is where a model's answer is read
      } catch (error) {
        if (error instanceof ModelFailed) throw error;
        if (error instanceof DOMException && error.name === "TimeoutError") {
          throw new ModelFailed("timeout");
        }
        if (error instanceof SyntaxError) {
          throw new ModelFailed("reply-unreadable");
        }
        throw new ModelFailed("unreachable");
      }
      const completion = completionSchema.safeParse(body);
      if (!completion.success) throw new ModelFailed("reply-unreadable");
      const content = completion.data.choices[0]?.message.content ?? "";
      try {
        return JSON.parse(content) as unknown;
      } catch {
        throw new ModelFailed("reply-not-json");
      }
    },
  };
}

export type CallCounter = Pick<
  Store,
  "countCall" | "modelCapSpent" | "recordModelCapReset"
>;

export interface CountedModel {
  // A call over the cap sends nothing and throws CapReached.
  forAccount(account: AccountId): Model;
  // The time the cap resets, while it is spent. Counts no call.
  spent(account: AccountId): Promise<Date | undefined>;
}

export function createCountedModel(
  config: Parameters<typeof createModel>[0] & {
    store: CallCounter;
    now?: () => Date;
  },
): CountedModel {
  const { store, now = () => new Date() } = config;
  const client = createModel(config);
  // Recording the reset raises the version, so open pages learn of it
  // (ADR 22).
  async function refuse(account: AccountId, at: Date): Promise<Date> {
    const resetsAt = new Date(
      windowOf(at, rateLimits.modelCall.windowMinutes).endsAt,
    );
    await store.recordModelCapReset(account, resetsAt);
    return resetsAt;
  }
  return {
    forAccount: (account) => ({
      async reply(request) {
        const at = now();
        const counted = await store.countCall(account, "modelCall", at);
        if (!counted.counted) throw new CapReached(await refuse(account, at));
        return client.reply(request);
      },
    }),
    async spent(account) {
      const at = now();
      return (await store.modelCapSpent(account, at))
        ? refuse(account, at)
        : undefined;
    },
  };
}
