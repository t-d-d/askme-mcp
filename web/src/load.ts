import { z } from "zod";
import {
  refusalAnswer,
  samplesPath,
  type AskChange,
} from "../../shared/page-api";

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
  return { answer: schema.parse(await response.json()), serviceAhead: ahead };
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
// service's moments never ends early. Nothing corrects it for a change to
// the device's clock while polls fail, on purpose (useAsks.ts, #340).
export function serviceAhead(response: Response, receivedAt: number): number {
  const date = httpDate.safeParse(response.headers.get("date"));
  return date.success ? date.data - receivedAt : 0;
}

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
