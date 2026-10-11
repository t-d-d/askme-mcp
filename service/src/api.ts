// The page's API: the routes the signed-in page calls (ADR 6). Each one
// verifies a session token and takes the account from it, never from the
// request. An agent's token is refused, because an agent reads nothing
// (ADR 2). A refusal uses the codes of the error contract (ADR 11), and only
// a missing or bad token is refused with a bare 401.
import { asksAnswer, connectionAnswer } from "../../shared/page-api";
import { pageRefusal } from "./errors";
import { AgentToken, TokenRejected, type AccountId } from "./identity";
import { errorClass, type Logger } from "./log";
import { mcpPath, type PageRoute } from "./routes";
import type { Store } from "./store/store";

export interface PageContext {
  // The address the caller used, from which the MCP endpoint's is built.
  origin: string;
  verify: (token: string) => Promise<AccountId>;
  store: Store;
  log: Logger;
}

const noStore = { "cache-control": "no-store" };

const answer = (body: unknown) => Response.json(body, { headers: noStore });

const unauthorised = (challenge: string) =>
  new Response(null, {
    status: 401,
    headers: { ...noStore, "www-authenticate": challenge },
  });

export function unavailable(): Response {
  return pageRefusal(
    "service_unavailable",
    "askme could not finish this request. Try again in a moment.",
  );
}

// The bearer token in a request, if it has one. API Gateway joins a repeated
// header with commas, and only the first counts.
function bearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization")?.split(",")[0];
  const match = /^Bearer\s+(\S+)\s*$/iu.exec(authorization ?? "");
  return match?.[1];
}

async function respond(
  route: PageRoute,
  account: AccountId,
  { origin, store }: PageContext,
): Promise<Response> {
  switch (route) {
    case "GET /api/asks": {
      const { version, everAsked, asks } = await store.openAsks(
        account,
        new Date(),
      );
      return answer(
        asksAnswer.parse({
          version,
          everAsked,
          asks: asks.map(({ id, summary, spokenDetail, postedAt }) => ({
            id,
            summary,
            spokenDetail,
            postedAt,
          })),
        }),
      );
    }
    case "GET /api/connection":
      return answer(
        connectionAnswer.parse({ mcpUrl: new URL(mcpPath, origin).href }),
      );
  }
}

export async function servePage(
  route: PageRoute,
  request: Request,
  context: PageContext,
): Promise<Response> {
  const { log } = context;
  const token = bearerToken(request);
  if (token === undefined) {
    log.info("token-missing");
    return unauthorised("Bearer");
  }
  try {
    const account = await context.verify(token);
    return await respond(route, account, context);
  } catch (error) {
    if (error instanceof TokenRejected) {
      log.info("token-rejected", { errorClass: error.reason });
      return unauthorised('Bearer error="invalid_token"');
    }
    if (error instanceof AgentToken) {
      log.info("agent-token-refused");
      return pageRefusal(
        "insufficient_scope",
        "This route is for the askme page, signed in as a person. An agent's connection can post asks and read nothing. Do not retry.",
      );
    }
    log.error("request-failed", { errorClass: errorClass(error) });
    return unavailable();
  }
}
