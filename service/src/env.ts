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

// The local DynamoDB that the integration tier runs (ADR 9). In production
// it is unset, and the client finds the region's endpoint itself.
const databaseEndpointSchema = z
  .url({ error: "DYNAMODB_ENDPOINT must be an address." })
  .refine(
    (value) => URL.canParse(value) && loopback.has(new URL(value).hostname),
    {
      error: "DYNAMODB_ENDPOINT may only point to this machine.",
    },
  );

const envSchema = z.object({
  CLERK_ISSUER: issuerSchema,
  TABLE_NAME: z.string().min(1, { error: "TABLE_NAME must name the table." }),
  DYNAMODB_ENDPOINT: databaseEndpointSchema.optional(),
});

export interface Env {
  clerkIssuer: string;
  tableName: string;
  databaseEndpoint?: string;
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
  const { CLERK_ISSUER, TABLE_NAME, DYNAMODB_ENDPOINT } = parsed.data;
  return {
    clerkIssuer: CLERK_ISSUER,
    tableName: TABLE_NAME,
    ...(DYNAMODB_ENDPOINT === undefined
      ? {}
      : { databaseEndpoint: DYNAMODB_ENDPOINT }),
  };
}
