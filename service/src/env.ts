// The service's environment, parsed once (ADR 10). This is the only module
// that reads process.env.
import { z } from "zod";
import { openRouterEndpoint } from "./model";

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

// An address in place of a cloud service's, for the stand-ins the
// integration tier runs (ADR 9): the local DynamoDB, the model faked with
// recorded replies, and fakes of Parameter Store and Lambda. In production
// each is unset, and the real service's address is used.
const loopbackEndpoint = (name: string) =>
  z
    .url({ error: `${name} must be an address.` })
    .refine(
      (value) => URL.canParse(value) && loopback.has(new URL(value).hostname),
      { error: `${name} may only point to this machine.` },
    );

const named = (name: string, what: string) =>
  z.string({ error: `${name} must name ${what}.` }).min(1, {
    error: `${name} must name ${what}.`,
  });

const envSchema = z.object({
  CLERK_ISSUER: issuerSchema,
  TABLE_NAME: named("TABLE_NAME", "the table"),
  // The function that sorts an ask after it is posted.
  SORT_FUNCTION: named("SORT_FUNCTION", "the function that sorts asks"),
  // The Parameter Store name of the service's OpenRouter key, which issue
  // #1 fixed.
  MODEL_KEY_PARAMETER: named(
    "MODEL_KEY_PARAMETER",
    "the parameter that holds the model's key",
  ),
  DYNAMODB_ENDPOINT: loopbackEndpoint("DYNAMODB_ENDPOINT").optional(),
  MODEL_ENDPOINT: loopbackEndpoint("MODEL_ENDPOINT").optional(),
  SSM_ENDPOINT: loopbackEndpoint("SSM_ENDPOINT").optional(),
  LAMBDA_ENDPOINT: loopbackEndpoint("LAMBDA_ENDPOINT").optional(),
});

export interface Env {
  clerkIssuer: string;
  tableName: string;
  sortFunction: string;
  modelKeyParameter: string;
  modelEndpoint: string;
  databaseEndpoint?: string;
  ssmEndpoint?: string;
  lambdaEndpoint?: string;
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
    sortFunction: env.SORT_FUNCTION,
    modelKeyParameter: env.MODEL_KEY_PARAMETER,
    modelEndpoint: env.MODEL_ENDPOINT ?? openRouterEndpoint,
    ...(env.DYNAMODB_ENDPOINT === undefined
      ? {}
      : { databaseEndpoint: env.DYNAMODB_ENDPOINT }),
    ...(env.SSM_ENDPOINT === undefined
      ? {}
      : { ssmEndpoint: env.SSM_ENDPOINT }),
    ...(env.LAMBDA_ENDPOINT === undefined
      ? {}
      : { lambdaEndpoint: env.LAMBDA_ENDPOINT }),
  };
}
