// The model (PRD, "Stack"): one chat completion through OpenRouter, which
// puts several models behind one key. This module is the boundary where a
// model's answer comes in. It hands its caller the reply's JSON unchecked,
// and the caller parses it with its own schema (ADR 10).
//
// It is also the one module in the service that builds the model client,
// and it counts every call against the account's daily cap just before
// sending it (ADR 21). The service reaches the model only through
// createCountedModel. The eval builds the client with createModel, on its
// own key, outside the cap.
//
// Every call asks for a reply that follows a JSON Schema, declares no
// tools, and is routed only to providers that keep no prompts (ADR 12).
// It also turns reasoning off. The provider counts the tokens a model spends
// thinking against max_tokens, so a model that thinks first can run out
// before its reply, or partway through it.
import { z } from "zod";
import type { AccountId } from "./identity";
import { modelCallLimit, windowOf } from "./rate";
import type { Store } from "./store/store";

// The model that sorts, chosen with the eval set: the best of the
// candidates in evals/scores.md. Changing it needs a run of the eval before
// and after.
export const defaultModel = "anthropic/claude-haiku-5.5";

// OpenRouter's API, which speaks OpenAI's chat completions.
export const openRouterEndpoint = "https://openrouter.ai/api/v1";

// A turn after the model's own earlier reply to the same system and user
// messages: that reply, as the JSON it gave, and a user message about it.
export interface FollowUp {
  reply: string;
  user: string;
}

export interface ModelRequest {
  system: string;
  user: string;
  // When set, the call goes on from the model's earlier reply.
  followUp?: FollowUp;
  // The name and JSON Schema the reply must follow.
  schemaName: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  timeoutMs: number;
}

// Why a call gave no reply to parse. The reason is safe to log: a status,
// "timeout", or a word for the shape of the answer, never its content.
export class ModelFailed extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`The model gave no reply: ${reason}.`);
    this.name = "ModelFailed";
    this.reason = reason;
  }
}

export interface Model {
  reply(request: ModelRequest): Promise<unknown>;
}

// The account's daily cap on model calls is spent, so nothing was sent. The
// cap is working as designed, so this is not a failure of the model, and
// not askme's own. It says when the cap resets: the next midnight UTC.
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

// The parts of a chat completion this module reads.
const completionSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string() }) }))
    .min(1),
});

export function createModel(config: {
  endpoint: string;
  model: string;
  // The key for OpenRouter, or undefined to send none, as in a Claude cloud
  // session, where the key is added after the request leaves the session.
  key: () => Promise<string | undefined>;
  fetch?: Fetch;
}): Model {
  const send = config.fetch ?? fetch;
  return {
    async reply(request) {
      // One time limit covers reading the key as well as the call, so a slow
      // read leaves the call less time and never adds to it. A key that
      // cannot be read is askme's own failure, not the model's, so it is
      // thrown as it came.
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
            provider: {
              data_collection: "deny",
              zdr: true,
              require_parameters: true,
            },
            reasoning: { enabled: false },
            max_tokens: request.maxTokens,
          }),
          signal,
        });
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

// The parts of the store that keep the count of model calls.
export type CallCounter = Pick<
  Store,
  "countModelCall" | "modelCapSpent" | "recordModelCapReset"
>;

// The model as the service reaches it: every call is made for one account,
// and counted against that account's daily cap just before it is sent.
export interface CountedModel {
  // The model for one account's calls: the reading of its rules, or a try
  // of a sort of one of its asks. A call over the cap sends nothing, and
  // throws CapReached.
  forAccount(account: AccountId): Model;
  // When the account's cap is spent, the time it resets. Undefined while it
  // has calls left. It counts nothing, for a save that makes no call.
  spent(account: AccountId): Promise<Date | undefined>;
}

export function createCountedModel(
  config: Parameters<typeof createModel>[0] & {
    store: CallCounter;
    // The time now, which names the day a call is counted in.
    now?: () => Date;
  },
): CountedModel {
  const { store, now = () => new Date() } = config;
  const client = createModel(config);
  // The cap refused, so META records when it resets, the first time in its
  // day, raising the version so every open page learns of it (ADR 22).
  async function refuse(account: AccountId, at: Date): Promise<Date> {
    const resetsAt = new Date(
      windowOf(at, modelCallLimit.windowMinutes).endsAt,
    );
    await store.recordModelCapReset(account, resetsAt);
    return resetsAt;
  }
  return {
    forAccount: (account) => ({
      async reply(request) {
        const at = now();
        const counted = await store.countModelCall(account, at);
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
