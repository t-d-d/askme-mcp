// Loads one answer from the page's API, with the session token, and parses
// it with the schema both sides share. A failure of any kind throws.
import type { z } from "zod";

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
