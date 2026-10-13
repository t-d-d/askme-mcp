import { z } from "zod";
import { limits, text } from "./ask";
import { Refused, retryBudget } from "./errors";
import { guidance, resendAfterTimeout } from "./instructions";
import type { ToolDefinition } from "./tools";

const resolveInput = z.strictObject({
  id: text(limits.id).describe(
    "The id the ask tool gave back when you posted the ask.",
  ),
});

// Nothing about the account (ADR 2).
const resolveOutput = z.strictObject({
  id: z.string(),
  status: z.literal("resolved"),
});

// The same words for an id that never existed and for another account's
// (ADR 2).
const notFound = new Refused(
  "not_found",
  "askme has no ask with this id, so there is nothing to resolve. Do not retry. Carry on with your work.",
);

export const resolveTool: ToolDefinition<
  typeof resolveInput,
  typeof resolveOutput
> = {
  name: "resolve",
  description: [
    "Resolve an ask: close it by the id the ask tool gave you, and it leaves the person's askme list.",
    guidance.resolve,
    "Resolving an ask that is already closed succeeds.",
    resendAfterTimeout("resolve"),
    guidance.ownSession,
    `If askme refuses with a code marked retry, send the same call again at most ${String(retryBudget)} times, then carry on without askme.`,
  ].join(" "),
  input: resolveInput,
  output: resolveOutput,
  // No rate limit on purpose. Only an ask's first close writes, and the
  // daily cap bounds the asks. A counter would add a write to every call, so
  // a flood would cost more with a limit than without one.
  async run({ id }, { caller, log, store }) {
    const { accountId } = caller;
    const found = await store.resolveAsk(accountId, id, new Date());
    switch (found) {
      case "resolved":
        log.info("ask-resolved", { accountId, askId: id });
        return { id, status: "resolved" };
      // The same answer, which says nothing of how it closed (ADR 2).
      case "already-closed":
        log.info("ask-already-closed", { accountId, askId: id });
        return { id, status: "resolved" };
      case "not-found":
        log.info("ask-not-found", { accountId });
        return notFound;
    }
  },
};
