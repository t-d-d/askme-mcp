// Clerk issues every token (ADR 6). The service only verifies them.
import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthProtectedResourceMetadata,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import { createRemoteJWKSet, errors, jwtVerify } from "jose";
import { z } from "zod";

// The one scope. It covers every tool (ADR 2).
export const askScope = "asks:create";

// Only this module can make an AccountId, from a verified token (ADR 13).
declare const accountBrand: unique symbol; // eslint-disable-line @typescript-eslint/no-unused-vars -- a symbol that exists only as a type, so no other module can name the brand
const accountIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/u)
  .brand<typeof accountBrand>();

export type AccountId = z.output<typeof accountIdSchema>;

// For a job only the service queues, with the id its own token check gave,
// so the id still comes from a token (ADR 13).
export function jobAccount(value: unknown): AccountId {
  return accountIdSchema.parse(value);
}

// Clerk puts the scopes in scp as a list, or in scope as one string.
const claimsSchema = z.object({
  sub: accountIdSchema,
  exp: z.number(),
  client_id: z.string().optional(),
  scp: z.array(z.string()).optional(),
  scope: z.string().optional(),
});

export interface Caller {
  accountId: AccountId;
  scopes: string[];
  requestId: string;
}

const extraSchema = z.object({
  accountId: accountIdSchema,
  requestId: z.string().min(1),
});

export function callerOf(authInfo: AuthInfo | undefined): Caller {
  const { accountId, requestId } = extraSchema.parse(authInfo?.extra);
  return { accountId, requestId, scopes: authInfo?.scopes ?? [] };
}

// jose errors that mean the token itself is bad, not that the keys could
// not be fetched or read.
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

// reason is logged, so it never holds the token.
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

// The set caches what it fetches, so one set serves both kinds of token.
export type KeySet = ReturnType<typeof createRemoteJWKSet>;

export function keySet(issuer: string): KeySet {
  return createRemoteJWKSet(new URL("/.well-known/jwks.json", issuer));
}

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

// Agents' tokens. The at+jwt type refuses the page's session tokens. The
// audience is not checked: Clerk's "Include audience" setting is off, so its
// tokens carry none, and this Clerk instance issues tokens for askme alone.
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

export class AgentToken extends Error {
  constructor() {
    super("An agent's token cannot read anything from askme.");
    this.name = "AgentToken";
  }
}

// Only a session token carries sid.
const sessionClaimsSchema = z.object({
  sub: accountIdSchema,
  sid: z.string().min(1),
});

// The page's tokens. Session tokens carry no scope and no audience. An
// audience marks a token such as the OpenID ID token Clerk gives an agent's
// OAuth client.
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

// RFC 9728 metadata, which a 401 points to.
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
