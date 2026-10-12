// Reading the rules (PRD, "How it works"): on save, one model call lists the
// hashtags the rules name. Nothing else in the rules is compiled.
//
// The rules are the person's own, but the reply is still checked in code.
// A hashtag must be written in the rules with # in front of it, so code can
// check every name the model gives, and a reply that does not fit is
// discarded whole, leaving the hashtags as they were.
import { z } from "zod";
import { ModelFailed, type Model } from "./model";
import { escaped, type Prompt } from "./sort";

// The most hashtags askme keeps. The palette starts again after eight.
export const hashtagLimit = 12;

// A hashtag's name: letters and digits, with hyphens and underscores after
// the first, at most 24 characters, in lower case and without its #.
const nameShape = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,23}$/u;

const system = [
  "You read one person's rules for sorting the asks their AI agents send them.",
  "List the hashtags the rules name, in the order they first appear. A hashtag is a word written with # in front of it, such as #work.",
  "Give each one once, without the #. If the rules name none, give an empty list.",
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
      },
      required: ["hashtags"],
      additionalProperties: false,
    },
  };
}

// Where the rules first write a hashtag with its #, or -1 when they never do.
function firstWritten(name: string, text: string): number {
  const written = new RegExp(`#${name}(?![\\p{L}\\p{N}_-])`, "iu").exec(text);
  return written?.index ?? -1;
}

// The hashtags a reply names, in the order the rules first write them, or
// undefined when anything in it is out of place.
export function parseReading(
  reply: unknown,
  text: string,
): string[] | undefined {
  const parsed = z
    .strictObject({ hashtags: z.array(z.string()) })
    .safeParse(reply);
  if (!parsed.success) return undefined;
  const names = [
    ...new Set(
      parsed.data.hashtags.map((name) => name.replace(/^#/u, "").toLowerCase()),
    ),
  ];
  if (names.length > hashtagLimit) return undefined;
  const placed = names.map((name) => ({
    name,
    at: nameShape.test(name) ? firstWritten(name, text) : -1,
  }));
  if (placed.some(({ at }) => at < 0)) return undefined;
  return placed.sort((a, b) => a.at - b.at).map(({ name }) => name);
}

// How long reading the rules may take. The page waits for it, and the
// function behind the page's API stops at ten seconds.
const readingTimeoutMs = 7000;

// Room for a dozen hashtags.
const readingMaxTokens = 300;

// The hashtags the rules name, read by the model, or why they could not be
// read. Empty rules name none, with no model call.
export async function readHashtags(
  text: string,
  model: Model,
): Promise<{ hashtags: string[] } | { failed: string }> {
  if (text.trim() === "") return { hashtags: [] };
  try {
    const hashtags = parseReading(
      await model.reply({
        ...readingPrompt(text),
        schemaName: "hashtags",
        maxTokens: readingMaxTokens,
        timeoutMs: readingTimeoutMs,
      }),
      text,
    );
    return hashtags === undefined ? { failed: "reply-rejected" } : { hashtags };
  } catch (error) {
    if (error instanceof ModelFailed) return { failed: error.reason };
    throw error;
  }
}
