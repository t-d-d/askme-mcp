// The page's API: the routes the signed-in page calls (ADR 6). Each one
// verifies a session token and takes the account from it, never from the
// request. An agent's token is refused, because an agent reads nothing
// (ADR 2). A refusal uses the codes of the error contract (ADR 11), and only
// a missing or bad token is refused with a bare 401.
import { z } from "zod";
import {
  asksAnswer,
  asksUnchanged,
  connectionAnswer,
  sinceParam,
} from "../../shared/page-api";
import { pageRefusal } from "./errors";
import { authorizationOf } from "./http";
import { AgentToken, TokenRejected, type AccountId } from "./identity";
import { errorClass, type Logger } from "./log";
import { pollLimit } from "./rate";
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

// The version a poll carries, as the page sends it: a whole number.
const sinceSchema = z
  .string()
  .regex(/^\d{1,15}$/u)
  .transform(Number)
  .optional();

const plural = (count: number, word: string) =>
  `${String(count)} ${word}${count === 1 ? "" : "s"}`;

// Says what the limit is and how long to wait, from the limit's own
// constants (ADR 11).
function pollRefusal(secondsLeft: number): Response {
  const window =
    pollLimit.windowMinutes === 1
      ? "a minute"
      : plural(pollLimit.windowMinutes, "minute");
  return pageRefusal(
    "rate_limited",
    `The page polled more than ${String(pollLimit.polls)} times in ${window}, which is the limit for an account. Wait ${plural(secondsLeft, "second")}, then poll again.`,
  );
}

// The account's open asks, unless nothing changed since the version the
// poll carried. Every poll counts against the account's limit first.
async function poll(
  request: Request,
  account: AccountId,
  { store, log }: PageContext,
): Promise<Response> {
  const now = new Date();
  const counted = await store.countPoll(account, now);
  if (!counted.counted) {
    log.info("poll-limited", { accountId: account });
    return pollRefusal(counted.secondsLeft);
  }
  const since = sinceSchema.safeParse(
    new URL(request.url).searchParams.get(sinceParam) ?? undefined,
  );
  if (!since.success) {
    log.info("input-invalid");
    return pageRefusal(
      "invalid_input",
      `"${sinceParam}" must be a whole number: the version of the last answer. Send it as it came, or leave it out to get the whole list.`,
    );
  }
  const found = await store.asksSince(account, since.data, now);
  if ("unchanged" in found) return answer(asksUnchanged.parse(found));
  const { version, everAsked, asks } = found;
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

// The bearer token in a request, if it has one.
function bearerToken(request: Request): string | undefined {
  const match = /^Bearer\s+(\S+)\s*$/iu.exec(authorizationOf(request) ?? "");
  return match?.[1];
}

async function respond(
  route: PageRoute,
  request: Request,
  account: AccountId,
  context: PageContext,
): Promise<Response> {
  switch (route) {
    case "GET /api/asks":
      return poll(request, account, context);
    case "GET /api/connection":
      return answer(
        connectionAnswer.parse({
          mcpUrl: new URL(mcpPath, context.origin).href,
        }),
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
    return await respond(route, request, account, context);
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
