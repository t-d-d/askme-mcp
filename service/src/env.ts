// The service's environment, parsed once (ADR 10). This is the only module
// that reads process.env.
import { z } from "zod";

const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);

// Clerk's issuer: the address of the instance that signs agents' tokens,
// which publishes its keys under /.well-known/jwks.json. It must be https,
// except on loopback, where the tests run a stand-in for Clerk.
const issuerSchema = z
  .url({ error: "CLERK_ISSUER must be the Clerk issuer's address." })
  .transform((value) => new URL(value))
  .refine(
    (url) =>
      url.protocol === "https:" ||
      (url.protocol === "http:" && loopback.has(url.hostname)),
    { error: "CLERK_ISSUER must use https." },
  )
  .refine(
    (url) =>
      (url.pathname === "/" || url.pathname === "") &&
      url.search === "" &&
      url.hash === "",
    {
      error: "CLERK_ISSUER must be an origin, with no path, query or fragment.",
    },
  )
  .transform((url) => url.origin);

const envSchema = z.object({ CLERK_ISSUER: issuerSchema });

export interface Env {
  clerkIssuer: string;
}

export function readEnv(
  // eslint-disable-next-line no-restricted-properties -- this module is where the environment is read
  source: Record<string, string | undefined> = process.env,
): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `The environment is not set up: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return { clerkIssuer: parsed.data.CLERK_ISSUER };
}
