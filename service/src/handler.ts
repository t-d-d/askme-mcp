// The function behind API Gateway: the MCP endpoint, its OAuth metadata and
// the page's API.
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
import { servePage } from "./api";
import { askTool } from "./ask";
import { readEnv } from "./env";
import { unavailable } from "./errors";
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
import { createCountedModel, defaultModel, type CountedModel } from "./model";
import { resolveTool } from "./resolve";
import { isPageRoute, isRoute, mcpPath, routes } from "./routes";
import { createKeyReader } from "./secrets";
import { createStore, type Store } from "./store/store";
import { addTool } from "./tools";

export { routes };

// OAuthError's code is typed as any string, so compare it as one.
const invalidToken: string = OAuthErrorCode.InvalidToken;

// A fresh server for each request, as the SDK's stateless serving does.
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

// Every exchange is a short request and response, so a client asking to
// hold a stream open for change notices is refused at once (ADR 1).
const mcp = createMcpHandler(buildServer, { maxSubscriptions: 0 });

interface Services {
  issuer: string;
  verifier: OAuthTokenVerifier;
  verifySession: (token: string) => Promise<AccountId>;
  store: Store;
  sorts: SortRequests;
  model: CountedModel;
}

// Set up on the first request, so that a test can set the environment first.
let services: Services | undefined;

function ready(): Services {
  if (services === undefined) {
    const env = readEnv();
    const keys = keySet(env.clerkIssuer);
    const store = createStore({
      tableName: env.tableName,
      endpoint: env.databaseEndpoint,
    });
    services = {
      issuer: env.clerkIssuer,
      verifier: tokenVerifier(env.clerkIssuer, keys),
      verifySession: sessionVerifier(env.clerkIssuer, keys),
      store,
      sorts: createSortRequests({
        queueUrl: env.sortQueue,
        endpoint: env.queueEndpoint,
      }),
      model: createCountedModel({
        endpoint: env.modelEndpoint,
        model: defaultModel,
        key: createKeyReader({
          parameter: env.modelKeyParameter,
          endpoint: env.ssmEndpoint,
        }),
        store,
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
    return await result(readable(request.route, await serve(request, log)));
  } catch (error) {
    log.error("request-failed", { errorClass: errorClass(error) });
    return result(readable(request.route, unavailable()));
  }
}

// A browser-based client reads the metadata, so it must be able to read
// every answer the metadata's route gives, its failure included.
function readable(route: string, response: Response): Response {
  if (isRoute(route) && routes[route] === "public") {
    response.headers.set("access-control-allow-origin", "*");
  }
  return response;
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
    return Response.json(resourceMetadata(resource, issuer));
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
