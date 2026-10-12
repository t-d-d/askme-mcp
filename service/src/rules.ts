// Reading the rules (PRD, "How it works"): on save, one model call lists the
// hashtags the rules name, and the hours the rules limit any of them to.
// Nothing else in the rules is compiled. The hours are applied in code, by
// the page, and never by a model (ADR 12).
//
// The rules are the person's own, but the reply is still checked in code.
// A hashtag must be written in the rules with # in front of it, so code can
// check every name the model gives, a window must name one of those
// hashtags, its days and its times, and a reply that does not fit is
// discarded whole, leaving the hashtags and their hours as they were.
import { z } from "zod";
import { timeWindow, weekdays } from "../../shared/page-api";
import { ModelFailed, type Model } from "./model";
import { escaped, type Prompt } from "./sort";

// The most hashtags askme keeps. The palette starts again after eight.
export const hashtagLimit = 12;

// The most windows of hours askme keeps, across all the hashtags: two a
// day for one hashtag, or two each for a dozen. The reply's token budget
// below holds this many.
export const windowLimit = 24;

// A hashtag's name: letters and digits, with hyphens and underscores after
// the first, at most 24 characters, in lower case and without its #.
const nameShape = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,23}$/u;

// One window of hours, with the hashtag it belongs to.
export const hashtagWindow = timeWindow.extend({ hashtag: z.string() });

export type HashtagWindow = z.infer<typeof hashtagWindow>;

// What askme reads from the rules: the hashtags, in the order the rules
// first write them, and every window of hours the rules give any of them.
// A hashtag with no window shows at any time.
export interface Reading {
  hashtags: string[];
  hours: HashtagWindow[];
}

// The rules a new account starts with, until the person saves their own
// (PRD, "Rules"), as docs/design/mockup/rules.html shows them. They name the
// three areas the sample asks come from, so sorting can be watched with no
// agent connected. They are read here, with no model call, and a test
// checks that the reading is one a model's reply could give.
export const exampleRules: { text: string; reading: Reading } = {
  text: [
    "#work is my day job. Only show it on weekdays between 8am and 6pm.",
    "#shop is my online shop. Anything a customer can see comes first.",
    "#family is home and the children. Show it at any time.",
    "Anything that blocks a release or costs money ranks high. Routine questions rank low.",
  ].join("\n\n"),
  reading: {
    hashtags: ["work", "shop", "family"],
    hours: [
      {
        hashtag: "work",
        days: ["mon", "tue", "wed", "thu", "fri"],
        from: "08:00",
        to: "18:00",
      },
    ],
  },
};

const system = [
  "You read one person's rules for sorting the asks their AI agents send them.",
  "List the hashtags the rules name, in the order they first appear. A hashtag is a word written with # in front of it, such as #work.",
  "Give each one once, without the #. If the rules name none, give an empty list.",
  "Then list the hours the rules limit any hashtag to, as windows of the week. Give each window the hashtag it belongs to, the days it opens on, and the times it opens and closes, on the 24-hour clock, such as 08:00 and 18:00.",
  "A window that runs past midnight closes at a time before it opens, and belongs to the days it opens on. A window that runs to the end of the day closes at 24:00, so a whole day is 00:00 to 24:00.",
  "Give a hashtag no window when the rules give it no hours, or say it can come at any time. A time that only says what comes first, such as a deadline, is not a window.",
  "Reply with the JSON the schema asks for.",
].join("\n");

export function readingPrompt(text: string): Prompt {
  return {
    system,
    user: `<rules>\n${escaped(text)}\n</rules>`,
    schema: {
      type: "object",
      properties: {
        hashtags: { type: "array", items: { type: "string" } },
        hours: {
          type: "array",
          items: {
            type: "object",
            properties: {
              hashtag: { type: "string" },
              days: {
                type: "array",
                items: { type: "string", enum: [...weekdays] },
              },
              from: { type: "string" },
              to: { type: "string" },
            },
            required: ["hashtag", "days", "from", "to"],
            additionalProperties: false,
          },
        },
      },
      required: ["hashtags", "hours"],
      additionalProperties: false,
    },
  };
}

// The reply, as the schema above asks for it.
const replySchema = z.strictObject({
  hashtags: z.array(z.string()),
  hours: z.array(z.strictObject(hashtagWindow.shape)),
});

// A hashtag as the model may write it: with its #, or in capitals.
const plainName = (name: string) => name.replace(/^#/u, "").toLowerCase();

// Where the rules first write a hashtag with its #, or -1 when they never do.
function firstWritten(name: string, text: string): number {
  const written = new RegExp(`#${name}(?![\\p{L}\\p{N}_-])`, "iu").exec(text);
  return written?.index ?? -1;
}

// What a reply read, with the hashtags in the order the rules first write
// them and each window's days once each, in the week's order, or undefined
// when anything in it is out of place.
export function parseReading(
  reply: unknown,
  text: string,
): Reading | undefined {
  const parsed = replySchema.safeParse(reply);
  if (!parsed.success) return undefined;
  const names = [...new Set(parsed.data.hashtags.map(plainName))];
  if (names.length > hashtagLimit) return undefined;
  const placed = names.map((name) => ({
    name,
    at: nameShape.test(name) ? firstWritten(name, text) : -1,
  }));
  if (placed.some(({ at }) => at < 0)) return undefined;
  const hours = parsed.data.hours.map(({ hashtag, days, from, to }) => ({
    hashtag: plainName(hashtag),
    days: weekdays.filter((day) => days.includes(day)),
    from,
    to,
  }));
  const fits = hours.every(
    ({ hashtag, from, to }) => names.includes(hashtag) && from !== to,
  );
  if (!fits || hours.length > windowLimit) return undefined;
  return {
    hashtags: placed.sort((a, b) => a.at - b.at).map(({ name }) => name),
    hours,
  };
}

// How long reading the rules may take, reading the model's key included.
// The page waits for it, and the function behind the page's API stops at
// ten seconds.
const readingTimeoutMs = 7000;

// Room for a dozen hashtags and every window askme keeps, at about 40
// tokens a window.
const readingMaxTokens = 1200;

// The hashtags the rules name and their hours, read by the model, or why
// they could not be read. Empty rules name none, with no model call.
export async function readRules(
  text: string,
  model: Model,
): Promise<Reading | { failed: string }> {
  if (text.trim() === "") return { hashtags: [], hours: [] };
  try {
    const reading = parseReading(
      await model.reply({
        ...readingPrompt(text),
        schemaName: "hashtags",
        maxTokens: readingMaxTokens,
        timeoutMs: readingTimeoutMs,
      }),
      text,
    );
    return reading ?? { failed: "reply-rejected" };
  } catch (error) {
    if (error instanceof ModelFailed) return { failed: error.reason };
    throw error;
  }
}
