// The page's API: its routes, and what each one answers. The service builds
// its answers with these schemas and the page parses them with the same
// ones, so the two cannot drift apart while neither imports the other
// (ADR 10).
import { z } from "zod";

export const pagePaths = {
  asks: "/api/asks",
  connection: "/api/connection",
  rules: "/api/rules",
} as const;

// How much an ask matters, judged on what is stalled, from most to least.
// Sorting picks one, and the page orders by it. It is never shown.
export const levels = ["high", "normal", "low"] as const;

export type Level = (typeof levels)[number];

// One of the account's hashtags, in the order the rules give them. Its
// colour is a number: the place the hashtag took when it first appeared in
// the account's rules, which never changes. The page's palette turns it
// into a colour (docs/design.md).
export const hashtag = z.object({
  name: z.string(),
  colour: z.number().int().nonnegative(),
});

export type Hashtag = z.infer<typeof hashtag>;

// The account's open asks, the version they were read at, and whether the
// account has ever had an ask, which tells a new account from one that is
// all clear.
//
// Each ask carries its sort: its hashtags, in the rules' order, and its
// level. An ask not sorted yet carries null.
//
// Saving the rules sorts every open ask again, and each keeps its old sort
// until then, so an ask can carry a hashtag the rules no longer name. Those
// are the former hashtags, each with its colour. They have no tab.
export const asksAnswer = z.object({
  version: z.number().int().nonnegative(),
  everAsked: z.boolean(),
  hashtags: z.array(hashtag),
  formerHashtags: z.array(hashtag),
  asks: z.array(
    z.object({
      id: z.string(),
      summary: z.string(),
      spokenDetail: z.string(),
      postedAt: z.iso.datetime(),
      sort: z
        .object({ hashtags: z.array(z.string()), level: z.enum(levels) })
        .nullable(),
    }),
  ),
});

export type AsksAnswer = z.infer<typeof asksAnswer>;
export type PageAsk = AsksAnswer["asks"][number];

// A poll carries the version of the last answer in this query parameter, and
// gets the whole list only when the account's version has moved on (ADR 1).
export const sinceParam = "since";

// The answer to a poll whose version is still the account's.
export const asksUnchanged = z.strictObject({
  version: z.number().int().nonnegative(),
  unchanged: z.literal(true),
});

// A poll's answer: nothing new, or the whole list.
export const pollAnswer = z.union([asksUnchanged, asksAnswer]);

export type PollAnswer = z.infer<typeof pollAnswer>;

// What the page needs to help someone connect an agent.
export const connectionAnswer = z.object({
  mcpUrl: z.url({ protocol: /^https$/u }),
});

export type ConnectionAnswer = z.infer<typeof connectionAnswer>;

// The most characters the rules may hold.
export const rulesLimit = 2000;

// What the page sends to save the rules.
export const rulesInput = z.strictObject({
  text: z.string().max(rulesLimit),
});

export type RulesInput = z.infer<typeof rulesInput>;

// The rules as last saved, and the hashtags askme read from them. When the
// last save could not be read, readFailed is set, and the hashtags are the
// ones read before it.
export const rulesAnswer = z.object({
  text: z.string(),
  hashtags: z.array(hashtag),
  readFailed: z.boolean(),
});

export type RulesAnswer = z.infer<typeof rulesAnswer>;

// A refusal from the page's API: one of the error contract's codes, whether
// to retry, and what to do (ADR 11).
export const refusalAnswer = z.object({
  code: z.string(),
  class: z.string(),
  message: z.string(),
});
