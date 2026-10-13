import { z } from "zod";

export const events = [
  "token-missing",
  "token-rejected",
  "scope-missing",
  "agent-token-refused",
  "input-invalid",
  "ask-posted",
  // Kept apart from ask-posted so agents' asks are counted alone.
  "sample-posted",
  // Counted to tune the dedupe window (ADR 3).
  "ask-deduplicated",
  "cap-reached",
  "rate-limited",
  // The id is the old ask's.
  "ask-replaced",
  "ask-resolved",
  "ask-already-closed",
  "ask-not-found",
  "ask-opened",
  "ask-dismissed",
  "poll-limited",
  "sort-request-failed",
  "sort-retried",
  "ask-sorted",
  "sort-capped",
  "sort-failed",
  "rules-saved",
  "rules-resaved",
  "rules-read-failed",
  "rules-limited",
  "rules-capped",
  "request-failed",
] as const;

export type Event = (typeof events)[number];

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u);

const fieldsSchema = z.strictObject({
  accountId: id.optional(),
  askId: id.optional(),
  // A tool's registered name, never the name a caller sent.
  tool: id.optional(),
  // A dependency's error class or code, never its message.
  errorClass: z
    .string()
    .regex(/^[A-Za-z0-9_.:-]{1,64}$/u)
    .optional(),
  status: z.number().int().optional(),
});

export type Fields = z.input<typeof fieldsSchema>;

export const fieldNames = Object.keys(fieldsSchema.shape);

// error: someone is alerted now. warn: handled, but suspect. info: as
// designed, expected refusals included.
export interface Logger {
  info: (event: Event, fields?: Fields) => void;
  warn: (event: Event, fields?: Fields) => void;
  error: (event: Event, fields?: Fields) => void;
}

type Level = keyof Logger;

export function createLogger(requestId: string): Logger {
  const write = (level: Level, event: Event, fields: Fields = {}) => {
    // One bad field drops them all, so nothing it held can reach the line.
    const parsed = fieldsSchema.safeParse(fields);
    const line = {
      event,
      requestId,
      ...(parsed.success ? parsed.data : { fieldsRejected: true }),
    };
    // Lambda's JSON log format stores the object as the message and takes
    // the level from the console method.
    console[level](line); // eslint-disable-line no-console -- the shared logger is the one place that writes a line
  };
  return {
    info: (event, fields) => {
      write("info", event, fields);
    },
    warn: (event, fields) => {
      write("warn", event, fields);
    },
    error: (event, fields) => {
      write("error", event, fields);
    },
  };
}

export function errorClass(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const code = "code" in error ? error.code : undefined;
  const name = typeof code === "string" ? code : error.name;
  return /^[A-Za-z0-9_.:-]{1,64}$/u.test(name) ? name : "Error";
}
