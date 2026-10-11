// The shared logger (ADR 7), and the only way service code logs.
//
// A line is one object: an event from the list below, the request id, and
// fields from a fixed allowlist. Lambda's JSON log format stores the object
// as the line's message and stamps the level from the console method used.
// Nothing a user or an agent wrote can be passed in, because no field takes
// it: there are ids, a tool's name, an error's class and a status.
import { z } from "zod";

// Every event the service logs. Count by event, never by level.
export const events = [
  // A call that needs a token carried none. Expected: on the MCP endpoint it
  // starts sign-in.
  "token-missing",
  // A token failed verification: expired, malformed, or not Clerk's.
  "token-rejected",
  // A verified token lacked asks:create, so a tool refused it.
  "scope-missing",
  // A route of the page's API got an agent's token, which reads nothing
  // (ADR 2), so it refused it.
  "agent-token-refused",
  // A tool's arguments failed its schema.
  "input-invalid",
  // An ask was accepted and answered with its id.
  "ask-posted",
  // Something failed that the service did not expect. Logged at error.
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
// designed, expected refusals included. There is no debug level.
export interface Logger {
  info: (event: Event, fields?: Fields) => void;
  warn: (event: Event, fields?: Fields) => void;
  error: (event: Event, fields?: Fields) => void;
}

type Level = keyof Logger;

export function createLogger(requestId: string): Logger {
  const write = (level: Level, event: Event, fields: Fields = {}) => {
    // A field that fails the allowlist is dropped with the rest, rather than
    // trimmed, so nothing it held can reach the line.
    const parsed = fieldsSchema.safeParse(fields);
    const line = {
      event,
      requestId,
      ...(parsed.success ? parsed.data : { fieldsRejected: true }),
    };
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

// The class of something thrown, to log in place of its message.
export function errorClass(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const code = "code" in error ? error.code : undefined;
  const name = typeof code === "string" ? code : error.name;
  return /^[A-Za-z0-9_.:-]{1,64}$/u.test(name) ? name : "Error";
}
