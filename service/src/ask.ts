// The ask tool. For the first test (issue #3) it parses an ask with the real
// schema and answers with a fixed id. Nothing is stored yet.
import { z } from "zod";
import { retryBudget } from "./errors";
import type { ToolDefinition } from "./tools";

export const fixedAskId = "first-test";

const httpsLink = z.url({
  protocol: /^https$/u,
  error: "must be an https URL",
});

const askInput = z.strictObject({
  summary: z.string().describe("One or two lines for the person's list."),
  area: z
    .string()
    .describe(
      "One short line naming the project or part of life this ask belongs to. Broad, not the task in hand.",
    ),
  spoken_detail: z
    .string()
    .describe(
      "Plain sentences written to be heard, about a minute of speech at most. No markdown, code, file paths or raw URLs.",
    ),
  action_link: httpsLink
    .optional()
    .describe(
      "Where the person takes the action, when that is not your session: a pull request or a ticket, say.",
    ),
  session_link: httpsLink
    .optional()
    .describe(
      "A link back to your session, for when the person needs to reply to you.",
    ),
  replaces: z
    .string()
    .optional()
    .describe("The id of an earlier ask that this one takes over from."),
});

const askOutput = z.object({
  id: z.string(),
  status: z.literal("posted"),
});

export const askTool: ToolDefinition<typeof askInput, typeof askOutput> = {
  name: "ask",
  description: `Post an ask: something you need the person to decide, answer or do before your work can go on. It joins their askme list and returns the ask's id. Ask the same question in your own session as well. If askme refuses with a code marked retry, send the same call again at most ${String(retryBudget)} times, then carry on without askme.`,
  input: askInput,
  output: askOutput,
  run(_input, { caller, log }) {
    log.info("ask-posted", { accountId: caller.accountId, askId: fixedAskId });
    return Promise.resolve({ id: fixedAskId, status: "posted" });
  },
};
