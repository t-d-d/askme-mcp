// The ask tool: an agent posts something it needs the person for. The ask
// is checked against its limits, stored, and answered with its id. An ask
// that names an earlier one in replaces takes its place. A repeat of an ask
// posted in the last ten minutes is answered with the first one's id. An
// account over its rate or its daily cap is refused.
//
// Each field's limit is a constant here, and the schema, the field's
// description and the refusal's message all take it from here, so the three
// cannot disagree (ADR 11). The daily cap is the store's constant and the
// rate is rate.ts's, and the refusals' messages take them from there.
import { z } from "zod";
import { Refused, retryBudget } from "./errors";
import { guidance } from "./instructions";
import { queueSorts } from "./jobs";
import { rateLimits } from "./rate";
import { askLifetimeDays, dailyAskCap } from "./store/store";
import type { ToolDefinition } from "./tools";
import { countPer, waitFor } from "./wording";

// The most characters each field may hold. A summary is one or two lines on
// a phone. The spoken detail is about a minute of speech. An id is one that
// ask gave back, in replaces or for resolve.
//
// The most minutes an ask may say it has until it stops mattering is the
// time until it is deleted, a month after it is posted.
export const limits = {
  summary: 80,
  area: 60,
  spokenDetail: 900,
  link: 2000,
  id: 64,
  staleAfterMinutes: askLifetimeDays * 24 * 60,
} as const;

// A field's problem in words a model can act on. It names the limit, never
// the value sent.
const required = {
  error: (issue: { input?: unknown }) =>
    issue.input === undefined ? "is missing" : "must be text",
};

export const text = (limit: number) =>
  z
    .string(required)
    .trim()
    .min(1, { error: "is empty" })
    .max(limit, { error: `is longer than ${String(limit)} characters` });

const httpsLink = z
  .url({ protocol: /^https$/u, error: "must be an https URL" })
  .max(limits.link, {
    error: `is longer than ${String(limits.link)} characters`,
  });

// A whole number of minutes, from one up to the limit. Every way it can be
// wrong gets the one message, which names the limit.
const staleMinutes = `must be a whole number of minutes from 1 to ${String(limits.staleAfterMinutes)}`;
const minutes = z
  .int({ error: staleMinutes, abort: true })
  .min(1, { error: staleMinutes })
  .max(limits.staleAfterMinutes, { error: staleMinutes });

const askInput = z.strictObject({
  summary: text(limits.summary).describe(
    `One or two lines for the person's list, at most ${String(limits.summary)} characters. Say what you need from them.`,
  ),
  area: text(limits.area).describe(
    `Required. One short line, at most ${String(limits.area)} characters, naming the project or part of life this ask belongs to. Broad, not the task in hand. It helps askme sort the ask and is not shown.`,
  ),
  spoken_detail: text(limits.spokenDetail).describe(
    `Plain sentences written to be heard, at most ${String(limits.spokenDetail)} characters, which is about a minute of speech. No markdown, code, file paths or raw URLs. When the thing waiting for the person is in one place only, say where, such as a browser tab on one machine.`,
  ),
  action_link: httpsLink
    .optional()
    .describe(
      `Optional. Where the person takes the action, when that is not your session: a pull request or a ticket, say. An https URL, at most ${String(limits.link)} characters.`,
    ),
  session_link: httpsLink
    .optional()
    .describe(
      `Optional. A link back to your session, for when the person needs to reply to you. An https URL, at most ${String(limits.link)} characters.`,
    ),
  replaces: text(limits.id)
    .optional()
    .describe(
      "Optional. The id of an earlier ask that this one takes over from. That ask closes, and this one takes its place. An id askme does not know, or one whose ask is already closed, is ignored, and this ask is posted as new.",
    ),
  stale_after_minutes: minutes
    .optional()
    .describe(
      `Optional. How many minutes from now until this ask stops mattering, a whole number from 1 to ${String(limits.staleAfterMinutes)}, which is ${String(askLifetimeDays)} days. Set it only when the ask stops mattering at that time, such as a passkey prompt that times out or a delivery slot that goes. Leave it out for a bill that falls due, which matters more as the day comes near. If something changes after the time passes, post a new ask with replaces.`,
    ),
});

// What an agent gets back: the id and a status, and nothing about the
// account (ADR 2).
const askOutput = z.strictObject({
  id: z.string(),
  status: z.literal("posted"),
});

export const askTool: ToolDefinition<typeof askInput, typeof askOutput> = {
  name: "ask",
  description: [
    "Post an ask: something you need the person to decide, answer or do before your work can go on. It joins their askme list and returns the ask's id.",
    guidance.post,
    guidance.several,
    guidance.resolve,
    "Resolve it with the resolve tool and its id.",
    guidance.replace,
    guidance.retry,
    guidance.ownSession,
    `If askme refuses with a code marked retry, send the same call again at most ${String(retryBudget)} times, then carry on without askme.`,
  ].join(" "),
  input: askInput,
  output: askOutput,
  async run(input, { caller, log, store, sorts }) {
    const { accountId } = caller;
    const now = new Date();
    // Every call is counted before anything is stored, so an agent that
    // floods, even with one ask repeated, is slowed (ADR 18).
    const counted = await store.countAsk(accountId, now);
    if (!counted.counted) {
      log.info("rate-limited", { accountId });
      return rateLimited(counted.secondsLeft);
    }
    const posting = await store.postAsk(
      accountId,
      {
        summary: input.summary,
        area: input.area,
        spokenDetail: input.spoken_detail,
        ...(input.action_link === undefined
          ? {}
          : { actionLink: input.action_link }),
        ...(input.session_link === undefined
          ? {}
          : { sessionLink: input.session_link }),
        ...(input.replaces === undefined ? {} : { replaces: input.replaces }),
        ...(input.stale_after_minutes === undefined
          ? {}
          : { staleAfterMinutes: input.stale_after_minutes }),
      },
      now,
    );
    switch (posting.kind) {
      case "posted":
        if (posting.replaced && input.replaces !== undefined) {
          log.info("ask-replaced", { accountId, askId: input.replaces });
        }
        log.info("ask-posted", { accountId, askId: posting.id });
        // Sorted after this call has answered, so posting never waits on
        // the model. If the queue cannot take it, the ask is still posted.
        await queueSorts({ sorts, log }, accountId, [posting.id], now);
        return { id: posting.id, status: "posted" };
      case "matched":
        // The same answer as a new ask's, so the agent cannot tell them
        // apart (ADR 3).
        log.info("ask-deduplicated", { accountId, askId: posting.id });
        return { id: posting.id, status: "posted" };
      case "over-cap":
        log.info("cap-reached", { accountId });
        return capReached(posting.resetsAt);
    }
  },
};

function capReached(resetsAt: Date): Refused {
  return new Refused(
    "cap_reached",
    `This account has posted ${String(dailyAskCap)} asks today, which is as many as askme takes in a day. The count starts again at ${resetsAt.toISOString()}, midnight UTC. Do not retry before then. Ask your question in your own session, and carry on.`,
  );
}

function rateLimited(waitSeconds: number): Refused {
  return new Refused(
    "rate_limited",
    `This account is posting asks too fast. askme takes at most ${countPer(rateLimits.ask, "asks")}. ${waitFor(waitSeconds)}, then send the same call again, at most ${String(retryBudget)} times in all. If it is still refused, carry on without askme.`,
  );
}
