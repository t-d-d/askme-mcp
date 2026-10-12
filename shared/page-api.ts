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

// The days of the week, from Monday, as a window of hours names them.
export const weekdays = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;

export type Weekday = (typeof weekdays)[number];

// A time of day on the 24-hour clock, such as 08:00.
export const clockTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

// The end of the day, which a window may close at but never open at.
export const endOfDay = "24:00";

// One window of a hashtag's hours (PRD, "Rules"): the days it opens on, and
// the times it opens and closes, on the wall clock of the time zone the
// rules were saved in. It is open from the minute it opens up to the minute
// it closes. One that closes before the time it opens runs past midnight
// into the next day. The page applies it, in code.
export const timeWindow = z.object({
  days: z.array(z.enum(weekdays)).min(1),
  from: z.string().regex(clockTime),
  to: z.union([z.string().regex(clockTime), z.literal(endOfDay)]),
});

export type TimeWindow = z.infer<typeof timeWindow>;

// One of the account's hashtags, in the order the rules give them. Its
// colour is a number: the place the hashtag took when it first appeared in
// the account's rules, which never changes. The page's palette turns it
// into a colour (docs/design.md). Its hours are the windows its asks show
// in, absent when the rules give it none, so it shows at any time.
export const hashtag = z.object({
  name: z.string(),
  colour: z.number().int().nonnegative(),
  hours: z.array(timeWindow).min(1).optional(),
});

export type Hashtag = z.infer<typeof hashtag>;

// The shape of a time zone's name in the IANA list, such as Europe/London,
// UTC or Etc/GMT+5. The service checks only the shape: the page applies the
// hours, in a zone its own browser knows, so a name the service's runtime
// does not know is kept as it was sent.
export const timeZoneShape = /^[A-Za-z][\w+-]*(?:\/[\w+-]+)*$/u;

// The most characters a time zone's name may hold. The longest IANA name is
// about 30.
export const timeZoneLimit = 64;

// The account's open asks, the version they were read at, and whether the
// account has ever had an ask, which tells a new account from one that is
// all clear.
//
// Each ask carries its sort: its hashtags, in the rules' order, and its
// level. An ask not sorted yet carries null.
//
// Saving the rules sorts every open ask again, and each keeps its old sort
// until then, so an ask can carry a hashtag the rules no longer name. Those
// are the former hashtags, each with its colour. They have no tab, and no
// hours.
//
// The time zone is the one the rules were saved in, which their hours use.
// It is absent until rules are saved with one, and the page then uses its
// own.
export const asksAnswer = z.object({
  version: z.number().int().nonnegative(),
  everAsked: z.boolean(),
  hashtags: z.array(hashtag),
  formerHashtags: z.array(hashtag),
  timeZone: z.string().optional(),
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

// What the page sends to save the rules: the text, and the time zone of the
// browser that saved them, which their hours use (PRD, "Rules"). Without a
// time zone the one saved before stays.
export const rulesInput = z.strictObject({
  text: z.string().max(rulesLimit),
  timeZone: z.string().max(timeZoneLimit).regex(timeZoneShape).optional(),
});

export type RulesInput = z.infer<typeof rulesInput>;

// The rules as last saved, the hashtags askme read from them with their
// hours, and the time zone the hours use, absent until rules are saved with
// one. When the last save could not be read, readFailed is set, and the
// hashtags and their hours are the ones read before it.
export const rulesAnswer = z.object({
  text: z.string(),
  hashtags: z.array(hashtag),
  readFailed: z.boolean(),
  timeZone: z.string().optional(),
});

export type RulesAnswer = z.infer<typeof rulesAnswer>;

// A refusal from the page's API: one of the error contract's codes, whether
// to retry, and what to do (ADR 11).
export const refusalAnswer = z.object({
  code: z.string(),
  class: z.string(),
  message: z.string(),
});
