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

// The claims the service reads from Clerk's OAuth access tokens. Clerk puts
// the scopes in scp as a list, or in scope as one string, and reads either.
const claimsSchema = z.object({
  sub: z.string().min(1),
  exp: z.number(),
  client_id: z.string().optional(),
  scp: z.array(z.string()).optional(),
  scope: z.string().optional(),
});

// Who is calling: the account comes from the verified token and nowhere else.
export interface Caller {
  accountId: string;
  scopes: string[];
  // API Gateway's id for the request, for the log lines it causes.
  requestId: string;
}

const extraSchema = z.object({
  accountId: z.string().min(1),
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

// Verifies Clerk's OAuth access tokens against the keys the issuer
// publishes. The keys are public, so the service holds no Clerk secret.
//
// Each token must be signed by the issuer, name it as iss, be typed as an
// OAuth access token (at+jwt), so a sign-in session token from the page is
// refused, and name an account. The audience is not checked: Clerk's
// "Include audience" setting is off, so its tokens carry none, and this
// Clerk instance issues tokens for askme alone (issue #1).
export function tokenVerifier(issuer: string): OAuthTokenVerifier {
  const keys = createRemoteJWKSet(new URL("/.well-known/jwks.json", issuer));
  return {
    async verifyAccessToken(token) {
      const payload = await jwtVerify(token, keys, {
        issuer,
        typ: "at+jwt",
        algorithms: ["RS256"],
        clockTolerance: 5,
      }).then(
        (verified) => verified.payload,
        (error: unknown) => {
          if (
            error instanceof errors.JOSEError &&
            tokenFaults.some((fault) => error instanceof fault)
          ) {
            throw new TokenRejected(reasonOf(error));
          }
          throw error;
        },
      );
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
