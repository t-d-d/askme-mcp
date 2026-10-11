// Identity (ADR 6). Clerk signs users in and is the OAuth server for agents.
// The service only verifies the access tokens Clerk issues, and takes the
// account from them.
import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthProtectedResourceMetadata,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import { createRemoteJWKSet, errors, jwtVerify } from "jose";
import { z } from "zod";

// The one scope an agent's token carries (ADR 2). It covers every tool.
export const askScope = "asks:create";

// An account id, as only a verified token can give it (ADR 13). The brand is
// a symbol this module keeps to itself, so no other code can make one, and
// the store's keys take nothing else. Clerk's user ids are short and plain.
declare const accountBrand: unique symbol; // eslint-disable-line @typescript-eslint/no-unused-vars -- a symbol that exists only as a type, so no other module can name the brand
const accountIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/u)
  .brand<typeof accountBrand>();

export type AccountId = z.output<typeof accountIdSchema>;

// The claims the service reads from Clerk's OAuth access tokens. Clerk puts
// the scopes in scp as a list, or in scope as one string, and reads either.
const claimsSchema = z.object({
  sub: accountIdSchema,
  exp: z.number(),
  client_id: z.string().optional(),
  scp: z.array(z.string()).optional(),
  scope: z.string().optional(),
});

// Who is calling: the account comes from the verified token and nowhere else.
export interface Caller {
  accountId: AccountId;
  scopes: string[];
  // API Gateway's id for the request, for the log lines it causes.
  requestId: string;
}

const extraSchema = z.object({
  accountId: accountIdSchema,
  requestId: z.string().min(1),
});

// The verified caller, from what the token check handed to the MCP server.
export function callerOf(authInfo: AuthInfo | undefined): Caller {
  const { accountId, requestId } = extraSchema.parse(authInfo?.extra);
  return { accountId, requestId, scopes: authInfo?.scopes ?? [] };
}

// jose errors that mean the token itself is bad, as opposed to the service
// failing to fetch or read Clerk's keys.
const tokenFaults = [
  errors.JWSInvalid,
  errors.JWTInvalid,
  errors.JWSSignatureVerificationFailed,
  errors.JWTClaimValidationFailed,
  errors.JWTExpired,
  errors.JWKSNoMatchingKey,
  errors.JWKSMultipleMatchingKeys,
  errors.JOSEAlgNotAllowed,
  errors.JOSENotSupported,
];

// A token refused for a fault of its own. The reason is jose's code for the
// fault, with the claim that failed when one did, so a log line can say why
// without holding the token.
export class TokenRejected extends OAuthError {
  readonly reason: string;
  constructor(reason: string) {
    super(
      OAuthErrorCode.InvalidToken,
      "The token is not a valid askme access token.",
    );
    this.reason = reason;
  }
}

function reasonOf(error: errors.JOSEError): string {
  return error instanceof errors.JWTClaimValidationFailed
    ? `${error.code}:${error.claim}`
    : error.code;
}

// The keys the issuer publishes. They are public, so the service holds no
// Clerk secret. One set serves both kinds of token, and caches what it fetches.
export type KeySet = ReturnType<typeof createRemoteJWKSet>;

export function keySet(issuer: string): KeySet {
  return createRemoteJWKSet(new URL("/.well-known/jwks.json", issuer));
}

// A token signed by the issuer and naming it as iss. A fault of the token's
// own is a TokenRejected. Failing to fetch the keys is not, and is thrown on.
async function signedByIssuer(
  token: string,
  keys: KeySet,
  issuer: string,
  typ?: string,
) {
  return jwtVerify(token, keys, {
    issuer,
    ...(typ === undefined ? {} : { typ }),
    algorithms: ["RS256"],
    clockTolerance: 5,
  }).catch((error: unknown) => {
    if (
      error instanceof errors.JOSEError &&
      tokenFaults.some((fault) => error instanceof fault)
    ) {
      throw new TokenRejected(reasonOf(error));
    }
    throw error;
  });
}

// Verifies Clerk's OAuth access tokens, which agents send.
//
// Each token must be signed by the issuer, name it as iss, be typed as an
// OAuth access token (at+jwt), so a sign-in session token from the page is
// refused, and name an account. The audience is not checked: Clerk's
// "Include audience" setting is off, so its tokens carry none, and this
// Clerk instance issues tokens for askme alone (issue #1).
export function tokenVerifier(
  issuer: string,
  keys: KeySet = keySet(issuer),
): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token) {
      const { payload } = await signedByIssuer(token, keys, issuer, "at+jwt");
      const claims = claimsSchema.safeParse(payload);
      if (!claims.success) throw new TokenRejected("claims");
      const { sub, exp, client_id, scp, scope } = claims.data;
      return {
        token,
        clientId: client_id ?? "",
        scopes: scp ?? scope?.split(" ") ?? [],
        expiresAt: exp,
        extra: { accountId: sub },
      };
    },
  };
}

// A verified token that an agent was given. It may post asks and read
// nothing (ADR 2), so the page's routes refuse it.
export class AgentToken extends Error {
  constructor() {
    super("An agent's token cannot read anything from askme.");
    this.name = "AgentToken";
  }
}

// The claims the service reads from Clerk's session tokens, which the page
// sends. Only a session token names a sign-in session, in sid.
const sessionClaimsSchema = z.object({
  sub: accountIdSchema,
  sid: z.string().min(1),
});

// Verifies the session tokens Clerk gives the page once a person signs in,
// and gives the account they name.
//
// A token typed as an OAuth access token, or carrying a scope, is an
// agent's: it is refused with AgentToken, whatever scope it holds. So is a
// token with an audience, such as an OpenID ID token, which Clerk gives an
// agent's OAuth client. Session tokens carry no scope and no audience.
export function sessionVerifier(
  issuer: string,
  keys: KeySet = keySet(issuer),
): (token: string) => Promise<AccountId> {
  return async (token) => {
    const { payload, protectedHeader } = await signedByIssuer(
      token,
      keys,
      issuer,
    );
    if (
      protectedHeader.typ?.toLowerCase() === "at+jwt" ||
      "scope" in payload ||
      "scp" in payload ||
      "aud" in payload
    ) {
      throw new AgentToken();
    }
    const claims = sessionClaimsSchema.safeParse(payload);
    if (!claims.success) throw new TokenRejected("claims");
    return claims.data.sub;
  };
}

// The protected resource metadata (RFC 9728) that a 401 points to. It names
// Clerk as the authorisation server, so a client knows where to sign in.
export function resourceMetadata(
  resource: URL,
  issuer: string,
): OAuthProtectedResourceMetadata {
  return {
    resource: resource.href,
    authorization_servers: [issuer],
    scopes_supported: [askScope],
    bearer_methods_supported: ["header"],
    resource_name: "askme",
  };
}
