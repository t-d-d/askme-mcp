// The Lambda function behind API Gateway's HTTP API (ADR 5): the MCP
// endpoint and the metadata that tells a client where to sign in.
//
// Every route but the metadata checks a token first (ADR 6). A call with no
// token, or one the service cannot verify, gets a 401 that points to the
// metadata. Anything after that, refusals included, is the MCP server's.
import {
  bearerAuthChallengeResponse,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  McpServer,
  OAuthError,
  OAuthErrorCode,
  verifyBearerToken,
  type AuthInfo,
  type McpRequestContext,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import { askTool } from "./ask";
import { readEnv } from "./env";
import { incoming, result, type Incoming, type Result } from "./http";
import {
  askScope,
  callerOf,
  resourceMetadata,
  tokenVerifier,
  TokenRejected,
} from "./identity";
import { createLogger, errorClass, type Logger } from "./log";
import { addTool } from "./tools";

const mcpPath = "/mcp";

// The routes API Gateway sends here, and who may call each. serverless.yml
// declares the same routes, and a static test keeps the two the same.
export const routes = {
  "POST /mcp": "token",
  "GET /mcp": "token",
  "DELETE /mcp": "token",
  "GET /.well-known/oauth-protected-resource/mcp": "public",
} as const satisfies Record<string, "token" | "public">;

type Route = keyof typeof routes;

const isRoute = (route: string): route is Route => Object.hasOwn(routes, route);

// OAuthError's code is typed as any string, so compare it as one.
const invalidToken: string = OAuthErrorCode.InvalidToken;

// A fresh MCP server for each request, as the SDK's stateless serving does.
// It sees the caller the token check verified.
function buildServer(context: McpRequestContext): McpServer {
  const server = new McpServer({ name: "askme", version: "1.0.0" });
  addTool(server, askTool, callerOf(context.authInfo));
  return server;
}

// Every exchange is a short request and response (ADR 1). A client on the
// 2026-07-28 revision may ask to hold a stream open for change notices, and
// with no subscriptions allowed it is refused at once.
const mcp = createMcpHandler(buildServer, { maxSubscriptions: 0 });

// Read on the first request, so that a test can set the environment first.
let identity: { issuer: string; verifier: OAuthTokenVerifier } | undefined;

function setUp() {
  const { clerkIssuer } = readEnv();
  return { issuer: clerkIssuer, verifier: tokenVerifier(clerkIssuer) };
}

export async function handler(event: unknown): Promise<Result> {
  const request = incoming(event);
  if (request === undefined) {
    // API Gateway always sends a well-formed event, so this is askme's fault.
    createLogger("unknown").error("request-failed", {
      errorClass: "UnreadableEvent",
    });
    return result(unavailable());
  }
  const log = createLogger(request.requestId);
  try {
    return await result(await serve(request, log));
  } catch (error) {
    log.error("request-failed", { errorClass: errorClass(error) });
    return result(unavailable());
  }
}

async function serve(
  { route, origin, request, requestId }: Incoming,
  log: Logger,
): Promise<Response> {
  if (!isRoute(route)) return new Response(null, { status: 404 });
  identity ??= setUp();
  const resource = new URL(mcpPath, origin);
  if (routes[route] === "public") {
    return Response.json(resourceMetadata(resource, identity.issuer), {
      headers: { "access-control-allow-origin": "*" },
    });
  }
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resource);
  // API Gateway joins a repeated header with commas. Only the first counts.
  const authorization = request.headers.get("authorization")?.split(",")[0];
  let authInfo: AuthInfo;
  try {
    authInfo = await verifyBearerToken(authorization, {
      verifier: identity.verifier,
      resourceMetadataUrl,
    });
  } catch (error) {
    if (!(error instanceof OAuthError) || error.code !== invalidToken) {
      throw error;
    }
    if (authorization === undefined) {
      log.info("token-missing");
    } else {
      log.info("token-rejected", {
        errorClass:
          error instanceof TokenRejected ? error.reason : errorClass(error),
      });
    }
    // The scope in the challenge tells a client what to ask Clerk for.
    return bearerAuthChallengeResponse(error, {
      requiredScopes: [askScope],
      resourceMetadataUrl,
    });
  }
  return mcp.fetch(request, {
    authInfo: { ...authInfo, extra: { ...authInfo.extra, requestId } },
  });
}

// Any failure the service did not expect. It is service_unavailable, which
// tells the caller to try again (ADR 11), and it says nothing more.
function unavailable(): Response {
  return Response.json(
    {
      error: "temporarily_unavailable",
      error_description: "askme could not finish this request. Try again.",
    },
    { status: 503 },
  );
}
