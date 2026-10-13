import { z } from "zod";
import { openRouterEndpoint } from "./model";

const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);

// Plain http is allowed only on loopback, where the tests run stand-ins.
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

// Only the integration tier's stand-ins set these (ADR 9). Production leaves
// them unset.
const loopbackEndpoint = (name: string) =>
  z
    .url({ error: `${name} must be an address.` })
    .refine(
      (value) => URL.canParse(value) && loopback.has(new URL(value).hostname),
      { error: `${name} may only point to this machine.` },
    );

const queueSchema = z
  .url({ error: "SORT_QUEUE must be the sort queue's address." })
  .refine(
    (value) => {
      if (!URL.canParse(value)) return false;
      const url = new URL(value);
      return (
        url.protocol === "https:" ||
        (url.protocol === "http:" && loopback.has(url.hostname))
      );
    },
    { error: "SORT_QUEUE must use https." },
  );

const named = (name: string, what: string) =>
  z.string({ error: `${name} must name ${what}.` }).min(1, {
    error: `${name} must name ${what}.`,
  });

const envSchema = z.object({
  CLERK_ISSUER: issuerSchema,
  TABLE_NAME: named("TABLE_NAME", "the table"),
  SORT_QUEUE: queueSchema,
  MODEL_KEY_PARAMETER: named(
    "MODEL_KEY_PARAMETER",
    "the parameter that holds the model's key",
  ),
  DYNAMODB_ENDPOINT: loopbackEndpoint("DYNAMODB_ENDPOINT").optional(),
  MODEL_ENDPOINT: loopbackEndpoint("MODEL_ENDPOINT").optional(),
  SSM_ENDPOINT: loopbackEndpoint("SSM_ENDPOINT").optional(),
  SQS_ENDPOINT: loopbackEndpoint("SQS_ENDPOINT").optional(),
});

export interface Env {
  clerkIssuer: string;
  tableName: string;
  sortQueue: string;
  modelKeyParameter: string;
  modelEndpoint: string;
  databaseEndpoint?: string;
  ssmEndpoint?: string;
  queueEndpoint?: string;
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
  const env = parsed.data;
  return {
    clerkIssuer: env.CLERK_ISSUER,
    tableName: env.TABLE_NAME,
    sortQueue: env.SORT_QUEUE,
    modelKeyParameter: env.MODEL_KEY_PARAMETER,
    modelEndpoint: env.MODEL_ENDPOINT ?? openRouterEndpoint,
    ...(env.DYNAMODB_ENDPOINT === undefined
      ? {}
      : { databaseEndpoint: env.DYNAMODB_ENDPOINT }),
    ...(env.SSM_ENDPOINT === undefined
      ? {}
      : { ssmEndpoint: env.SSM_ENDPOINT }),
    ...(env.SQS_ENDPOINT === undefined
      ? {}
      : { queueEndpoint: env.SQS_ENDPOINT }),
  };
}
