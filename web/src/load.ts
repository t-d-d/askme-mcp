// Loads one answer from the page's API, with the session token, and parses
// it with the schema both sides share. A failure of any kind throws.
import type { z } from "zod";
import { refusalAnswer } from "../../shared/page-api";

export async function load<T>(
  path: string,
  schema: z.ZodType<T>,
  getToken: () => Promise<string | null>,
  signal: AbortSignal,
): Promise<T> {
  const token = await getToken();
  const response = await fetch(path, {
    headers: { authorization: `Bearer ${token ?? ""}` },
    signal,
  });
  if (!response.ok) {
    throw new Error(`The API answered ${String(response.status)}.`);
  }
  return schema.parse(await response.json());
}

// A refusal from the page's API, with its code from the error contract, so
// the page can say what happened in its own words (docs/design.md).
export class Refusal extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "Refusal";
    this.code = code;
  }
}

// Sends a change to the page's API as JSON, with the session token, and
// parses the answer. A refusal throws as a Refusal, and any other failure
// as an error.
export async function send<T>(
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  getToken: () => Promise<string | null>,
): Promise<T> {
  const token = await getToken();
  const response = await fetch(path, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token ?? ""}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const refusal = refusalAnswer.safeParse(
      await response.json().catch(() => undefined),
    );
    throw refusal.success
      ? new Refusal(refusal.data.code, refusal.data.message)
      : new Error(`The API answered ${String(response.status)}.`);
  }
  return schema.parse(await response.json());
}
