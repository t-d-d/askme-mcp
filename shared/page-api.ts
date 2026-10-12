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

// How much an ask matters, judged on what it would cost if the person never
// acted, from most to least.
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

// A link an agent gave with its ask. The ask tool took only https.
const link = z.url({ protocol: /^https$/u });

// The account's open asks, the version they were read at, and whether the
// account has ever had an ask, which tells a new account from one that is
// all clear.
//
// Each ask carries the links its agent gave, if any, and whether the person
// has opened it by following one. It carries the time it stops mattering,
// when its agent gave one. It stays open after that time. It carries its
// sort: its hashtags, in the rules' order, its level, and the model's one
// line on why. An ask not sorted yet carries null.
//
// An ask behind the rules, not sorted yet or sorted with rules saved
// before, carries the time it turns from sorting to stopped (ADR 22). The
// page works out which it is as time passes, with no new poll. An ask
// sorted with the rules in force carries none.
//
// Saving the rules sorts every open ask again, and each keeps its old sort
// until then, so an ask can carry a hashtag the rules no longer name. Those
// are the former hashtags, each with its colour. They have no tab, and no
// hours.
//
// The time zone is the one the rules were saved in, which their hours use.
// It is absent until rules are saved with one, and the page then uses its
// own.
//
// While the account's daily cap on model calls is spent, the answer carries
// when it resets, the next midnight UTC (ADR 22). It is there from the
// first call the cap refuses, and only while that time is ahead. Nothing is
// written when it passes, so the page stops showing the cap by the clock.
export const asksAnswer = z.object({
  version: z.number().int().nonnegative(),
  everAsked: z.boolean(),
  hashtags: z.array(hashtag),
  formerHashtags: z.array(hashtag),
  timeZone: z.string().optional(),
  modelCapResetsAt: z.iso.datetime().optional(),
  asks: z.array(
    z.object({
      id: z.string(),
      summary: z.string(),
      spokenDetail: z.string(),
      actionLink: link.optional(),
      sessionLink: link.optional(),
      postedAt: z.iso.datetime(),
      lapsesAt: z.iso.datetime().optional(),
      opened: z.boolean(),
      sortingUntil: z.iso.datetime().optional(),
      sort: z
        .object({
          hashtags: z.array(z.string()),
          level: z.enum(levels),
          reason: z.string(),
        })
        .nullable(),
    }),
  ),
});

export type AsksAnswer = z.infer<typeof asksAnswer>;
export type PageAsk = AsksAnswer["asks"][number];

// The changes the page makes to one ask, each a route of its own that takes
// the ask's id in its body. Each one raises the account's version, so the
// next poll brings the list as it now is.
export const askChangePaths = {
  // The person followed one of the ask's links. It stays open, and sinks
  // below the unopened asks at its level.
  opened: "/api/asks/opened",
  // The person dismissed the ask, which closes.
  dismissed: "/api/asks/dismissed",
} as const;

// Posts sample asks into the account, one from each of three areas, as an
// agent would, so sorting can be watched with no agent connected (PRD, "Web
// page"). Each press posts different samples. It takes no body, and answers
// with no content once they are posted, or with a refusal at the account's
// rate or its daily cap.
export const samplesPath = "/api/asks/samples";

// The most characters an ask's id may hold, and the pattern of one: the
// letters, digits, - and _ askme's ids are made of. The page's card address
// and the changes it sends both use it.
export const askIdLimit = 64;
export const askIdPattern = new RegExp(
  `^[A-Za-z0-9_-]{1,${String(askIdLimit)}}$`,
  "u",
);

// What the page sends to change an ask: its id, as the list gave it.
export const askChange = z.strictObject({
  id: z.string().regex(askIdPattern),
});

export type AskChange = z.infer<typeof askChange>;

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
