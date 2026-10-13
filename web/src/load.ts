import { z } from "zod";
import {
  refusalAnswer,
  samplesPath,
  type AskChange,
} from "../../shared/page-api";
import { answerRead, reloadOnce, sessionMarks } from "./reload";

export async function load<T>(
  path: string,
  schema: z.ZodType<T>,
  getToken: () => Promise<string | null>,
  signal: AbortSignal,
): Promise<T> {
  return (await loadDated(path, schema, getToken, signal)).answer;
}

export async function loadDated<T>(
  path: string,
  schema: z.ZodType<T>,
  getToken: () => Promise<string | null>,
  signal: AbortSignal,
): Promise<{ answer: T; serviceAhead: number }> {
  const token = await getToken();
  const response = await fetch(path, {
    headers: { authorization: `Bearer ${token ?? ""}` },
    signal,
  });
  if (!response.ok) {
    throw new Error(`The API answered ${String(response.status)}.`);
  }
  const ahead = serviceAhead(response, Date.now());
  const answer = schema.safeParse(await response.json());
  // The poll's path carries the version it asks from.
  const [answerPath = path] = path.split("?");
  if (!answer.success) {
    // An answer in a shape the page does not know means a deploy has
    // changed it, and a newer page can read it.
    reloadOnce(
      sessionMarks,
      () => {
        window.location.reload();
      },
      answerPath,
    );
    throw answer.error;
  }
  answerRead(sessionMarks, answerPath);
  return { answer: answer.data, serviceAhead: ahead };
}

export class Refusal extends Error {
  readonly code: string;
  readonly serviceAhead: number;
  constructor(code: string, message: string, serviceAhead = 0) {
    super(message);
    this.name = "Refusal";
    this.code = code;
    this.serviceAhead = serviceAhead;
  }
}

export const capped = (error: Error | null): error is Refusal =>
  error instanceof Refusal && error.code === "cap_reached";

const httpDate = z
  .string()
  .transform((date) => Date.parse(date))
  .pipe(z.number().int());

// Milliseconds, negative when behind. The Date header is whole seconds,
// set as the answer left, so this errs behind and a wait for one of the
// service's moments never ends early.
export function serviceAhead(response: Response, receivedAt: number): number {
  const date = httpDate.safeParse(response.headers.get("date"));
  return date.success ? date.data - receivedAt : 0;
}

// Date.now() moves when the device's clock is set. performance.now() does
// not, but on most systems it stands still while the device sleeps.
export interface Moment {
  date: number;
  steady: number;
}

export const momentNow = (): Moment => ({
  date: Date.now(),
  steady: performance.now(),
});

// A visible page whose Date.now() gains this much on performance.now() is
// taken to have slept, since a device rarely sets its clock by this much.
const sleptAtLeast = 60 * 60 * 1000;

// Time passed is performance.now()'s count, so setting the device's clock
// moves nothing. Where the device may have slept, it is the larger of the
// two counts, as no less time can have passed.
export function aheadSince(
  ahead: number,
  then: Moment,
  now: Moment,
  visibleThroughout: boolean,
): number {
  const byDate = now.date - then.date;
  const bySteady = now.steady - then.steady;
  const mayHaveSlept = !visibleThroughout || byDate - bySteady >= sleptAtLeast;
  const passed = mayHaveSlept ? Math.max(byDate, bySteady) : bySteady;
  return ahead + passed - byDate;
}

// visibilityChanges may be counted at an earlier moment, such as when the
// poll was sent. That only reads a step as hidden more often, the safe side.
export interface Counted {
  serviceAhead: number;
  at: Moment;
  visibilityChanges: number;
}

export const countOn = (
  from: Counted,
  now: Moment,
  visibilityChanges: number,
): Counted => ({
  serviceAhead: aheadSince(
    from.serviceAhead,
    from.at,
    now,
    from.visibilityChanges === visibilityChanges,
  ),
  at: now,
  visibilityChanges,
});

async function sendJson(
  method: "PUT" | "POST",
  path: string,
  body: unknown,
  getToken: () => Promise<string | null>,
  keepalive = false,
): Promise<Response> {
  const token = await getToken();
  const authorization = `Bearer ${token ?? ""}`;
  const response = await fetch(path, {
    method,
    keepalive,
    ...(body === undefined
      ? { headers: { authorization } }
      : {
          headers: { authorization, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (!response.ok) {
    const ahead = serviceAhead(response, Date.now());
    const refusal = refusalAnswer.safeParse(
      await response.json().catch(() => undefined),
    );
    throw refusal.success
      ? new Refusal(refusal.data.code, refusal.data.message, ahead)
      : new Error(`The API answered ${String(response.status)}.`);
  }
  return response;
}

export async function send<T>(
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  getToken: () => Promise<string | null>,
): Promise<T> {
  const response = await sendJson("PUT", path, body, getToken);
  return schema.parse(await response.json());
}

export async function changeAsk(
  path: string,
  change: AskChange,
  getToken: () => Promise<string | null>,
  { keepalive = false }: { keepalive?: boolean } = {},
): Promise<void> {
  await sendJson("POST", path, change, getToken, keepalive);
}

export async function sendSamples(
  getToken: () => Promise<string | null>,
): Promise<void> {
  await sendJson("POST", samplesPath, undefined, getToken);
}
