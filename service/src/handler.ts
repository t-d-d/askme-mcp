// The Lambda function behind API Gateway's HTTP API (ADR 5): the MCP
// endpoint, the metadata that tells a client where to sign in, and the
// page's API.
//
// Every route but the metadata checks a token first (ADR 6). On the MCP
// endpoint, a call with no token, or one the service cannot verify, gets a
// 401 that points to the metadata. Anything after that, refusals included,
// is the MCP server's. The page's routes are served in api.ts.
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
import { servePage, unavailable as pageUnavailable } from "./api";
import { askTool } from "./ask";
import { readEnv } from "./env";
import {
  authorizationOf,
  incoming,
  result,
  type Incoming,
  type Result,
} from "./http";
import {
  askScope,
  callerOf,
  keySet,
  resourceMetadata,
  sessionVerifier,
  tokenVerifier,
  TokenRejected,
  type AccountId,
} from "./identity";
import { instructions } from "./instructions";
import { createSortRequests, type SortRequests } from "./jobs";
import { createLogger, errorClass, type Logger } from "./log";
import { createModel, defaultModel, type Model } from "./model";
import { resolveTool } from "./resolve";
import { isPageRoute, isRoute, mcpPath, routes } from "./routes";
import { createKeyReader } from "./secrets";
import { createStore, type Store } from "./store/store";
import { addTool } from "./tools";

export { routes };

// OAuthError's code is typed as any string, so compare it as one.
const invalidToken: string = OAuthErrorCode.InvalidToken;

// A fresh MCP server for each request, as the SDK's stateless serving does.
// It sees the caller the token check verified. Its tools and instructions
// are the same for every caller (ADR 2).
function buildServer(context: McpRequestContext): McpServer {
  const server = new McpServer(
    { name: "askme", version: "1.0.0" },
    { instructions },
  );
  const caller = callerOf(context.authInfo);
  const { store, sorts } = ready();
  addTool(server, askTool, caller, { store, sorts });
  addTool(server, resolveTool, caller, { store, sorts });
  return server;
}

// Every exchange is a short request and response (ADR 1). A client on the
// 2026-07-28 revision may ask to hold a stream open for change notices, and
// with no subscriptions allowed it is refused at once.
const mcp = createMcpHandler(buildServer, { maxSubscriptions: 0 });

interface Services {
  issuer: string;
  // Checks an agent's OAuth access token.
  verifier: OAuthTokenVerifier;
  // Checks the page's session token.
  verifySession: (token: string) => Promise<AccountId>;
  store: Store;
  // Hands a stored ask to the sort function.
  sorts: SortRequests;
  // Reads the rules when they are saved.
  model: Model;
}

// Set up on the first request, so that a test can set the environment first.
let services: Services | undefined;

function ready(): Services {
  if (services === undefined) {
    const env = readEnv();
    const keys = keySet(env.clerkIssuer);
    services = {
      issuer: env.clerkIssuer,
      verifier: tokenVerifier(env.clerkIssuer, keys),
      verifySession: sessionVerifier(env.clerkIssuer, keys),
      store: createStore({
        tableName: env.tableName,
        endpoint: env.databaseEndpoint,
      }),
      sorts: createSortRequests({
        functionName: env.sortFunction,
        endpoint: env.lambdaEndpoint,
      }),
      model: createModel({
        endpoint: env.modelEndpoint,
        model: defaultModel,
        key: createKeyReader({
          parameter: env.modelKeyParameter,
          endpoint: env.ssmEndpoint,
        }),
      }),
    };
  }
  return services;
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
    const { route } = request;
    return result(
      isRoute(route) && isPageRoute(route) ? pageUnavailable() : unavailable(),
    );
  }
}

async function serve(
  { route, origin, request, requestId }: Incoming,
  log: Logger,
): Promise<Response> {
  if (!isRoute(route)) return new Response(null, { status: 404 });
  const { issuer, verifier, verifySession, store, sorts, model } = ready();
  if (isPageRoute(route)) {
    return servePage(route, request, {
      origin,
      verify: verifySession,
      store,
      sorts,
      model,
      log,
    });
  }
  const resource = new URL(mcpPath, origin);
  if (routes[route] === "public") {
    return Response.json(resourceMetadata(resource, issuer), {
      headers: { "access-control-allow-origin": "*" },
    });
  }
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resource);
  const authorization = authorizationOf(request);
  let authInfo: AuthInfo;
  try {
    authInfo = await verifyBearerToken(authorization, {
      verifier,
      resourceMetadataUrl,
    });
  } catch (error) {
    if (!(error instanceof OAuthError) || error.code !== invalidToken) {
      throw error;
    }
    if (authorization === undefined || authorization.trim() === "") {
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
  const response = await mcp.fetch(request, {
    authInfo: { ...authInfo, extra: { ...authInfo.extra, requestId } },
  });
  // The SDK answers a failure of its own with a server error and logs
  // nothing, so it is logged here, by status only.
  if (response.status >= 500) {
    log.error("request-failed", { status: response.status });
  }
  return response;
}

// Any failure the service did not expect, outside the page's routes. It is
// service_unavailable, which tells the caller to try again (ADR 11), and it
// says nothing more.
function unavailable(): Response {
  return Response.json(
    {
      error: "temporarily_unavailable",
      error_description: "askme could not finish this request. Try again.",
    },
    { status: 503 },
  );
}
