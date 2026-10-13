// The model only lists the hashtags and their hours. The page applies the
// hours in code, never a model (ADR 12).
import { z } from "zod";
import { timeWindow, weekdays } from "../../shared/page-api";
import { ModelFailed, type Model } from "./model";
import { escaped, type Prompt } from "./sort";

// The palette starts again after eight.
export const hashtagLimit = 12;

// readingMaxTokens below holds this many.
export const windowLimit = 24;

const nameShape = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,23}$/u;

export const hashtagWindow = timeWindow.extend({ hashtag: z.string() });

export type HashtagWindow = z.infer<typeof hashtagWindow>;

// hashtags are in the order the rules first write them. A hashtag with no
// window shows at any time.
export interface Reading {
  hashtags: string[];
  hours: HashtagWindow[];
}

// As docs/design/mockup/rules.html shows them, naming the areas the sample
// asks come from. A test checks the reading is one a model could give.
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

const replySchema = z.strictObject({
  hashtags: z.array(z.string()),
  hours: z.array(z.strictObject(hashtagWindow.shape)),
});

// A hashtag as the model may write it: with its #, or in capitals.
const plainName = (name: string) => name.replace(/^#/u, "").toLowerCase();

// -1 when the rules never write the hashtag with its #, so the model made
// it up.
function firstWritten(name: string, text: string): number {
  const written = new RegExp(`#${name}(?![\\p{L}\\p{N}_-])`, "iu").exec(text);
  return written?.index ?? -1;
}

// Undefined when anything is out of place: a reply is discarded whole.
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

// The page waits for the reading, and the page API's function stops at ten
// seconds.
const readingTimeoutMs = 7000;

// Room for a dozen hashtags and every window askme keeps, at about 40
// tokens a window.
const readingMaxTokens = 1200;

export const emptyRules = (text: string): boolean => text.trim() === "";

export async function readRules(
  text: string,
  model: Model,
): Promise<Reading | { failed: string }> {
  if (emptyRules(text)) return { hashtags: [], hours: [] };
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
