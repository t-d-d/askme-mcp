// Shared by the service and the page, which never import each other
// (ADR 10).
import { z } from "zod";

export const pagePaths = {
  asks: "/api/asks",
  connection: "/api/connection",
  rules: "/api/rules",
} as const;

// From most to least. The page orders by level and never shows it.
export const levels = ["high", "normal", "low"] as const;

export type Level = (typeof levels)[number];

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

export const clockTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

export const endOfDay = "24:00";

// Wall-clock times in the rules' time zone, open from `from` up to `to`. A
// window that closes before it opens runs past midnight into the next day.
export const timeWindow = z.object({
  days: z.array(z.enum(weekdays)).min(1),
  from: z.string().regex(clockTime),
  to: z.union([z.string().regex(clockTime), z.literal(endOfDay)]),
});

export type TimeWindow = z.infer<typeof timeWindow>;

// colour is an index the page's palette turns into a colour, and never
// changes for a hashtag. Without hours, the hashtag shows at any time.
export const hashtag = z.object({
  name: z.string(),
  colour: z.number().int().nonnegative(),
  hours: z.array(timeWindow).min(1).optional(),
});

export type Hashtag = z.infer<typeof hashtag>;

// Only the shape is checked. The page applies the hours in its own browser,
// so a zone the service's runtime does not know is still kept.
export const timeZoneShape = /^[A-Za-z][\w+-]*(?:\/[\w+-]+)*$/u;

// The longest IANA name is about 30 characters.
export const timeZoneLimit = 64;

// The ask tool accepts only https links.
const link = z.url({ protocol: /^https$/u });

export const asksAnswer = z.object({
  version: z.number().int().nonnegative(),
  everAsked: z.boolean(),
  hashtags: z.array(hashtag),
  // Hashtags that older sorts still carry but the rules no longer name.
  formerHashtags: z.array(hashtag),
  timeZone: z.string().optional(),
  // Nothing is written when this passes, so the page stops showing the cap
  // by the clock.
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
      // Set on an ask behind the rules. After this time the page shows its
      // sort as stopped, with no new poll (ADR 22).
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

export const askChangePaths = {
  opened: "/api/asks/opened",
  dismissed: "/api/asks/dismissed",
} as const;

// Takes no body, and answers with no content or a refusal.
export const samplesPath = "/api/asks/samples";

export const askIdLimit = 64;
export const askIdPattern = new RegExp(
  `^[A-Za-z0-9_-]{1,${String(askIdLimit)}}$`,
  "u",
);

export const askChange = z.strictObject({
  id: z.string().regex(askIdPattern),
});

export type AskChange = z.infer<typeof askChange>;

export const sinceParam = "since";

export const asksUnchanged = z.strictObject({
  version: z.number().int().nonnegative(),
  unchanged: z.literal(true),
});

export const pollAnswer = z.union([asksUnchanged, asksAnswer]);

export type PollAnswer = z.infer<typeof pollAnswer>;

export const connectionAnswer = z.object({
  mcpUrl: z.url({ protocol: /^https$/u }),
});

export type ConnectionAnswer = z.infer<typeof connectionAnswer>;

export const rulesLimit = 2000;

export const rulesInput = z.strictObject({
  text: z.string().max(rulesLimit),
  timeZone: z.string().max(timeZoneLimit).regex(timeZoneShape).optional(),
});

export type RulesInput = z.infer<typeof rulesInput>;

// When readFailed, the hashtags are the ones read from an earlier save.
export const rulesAnswer = z.object({
  text: z.string(),
  hashtags: z.array(hashtag),
  readFailed: z.boolean(),
  timeZone: z.string().optional(),
});

export type RulesAnswer = z.infer<typeof rulesAnswer>;

// class says whether to retry (ADR 11).
export const refusalAnswer = z.object({
  code: z.string(),
  class: z.string(),
  message: z.string(),
});
