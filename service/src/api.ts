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
  rulesAnswer,
  rulesInput,
  rulesLimit,
  sinceParam,
} from "../../shared/page-api";
import { pageRefusal } from "./errors";
import { authorizationOf, jsonBody } from "./http";
import { AgentToken, TokenRejected, type AccountId } from "./identity";
import type { SortRequests } from "./jobs";
import { errorClass, type Logger } from "./log";
import type { Model } from "./model";
import { pollLimit, rulesSaveLimit } from "./rate";
import { mcpPath, type PageRoute } from "./routes";
import { readHashtags } from "./rules";
import type { AccountRules, StoredAsk, Store } from "./store/store";

export interface PageContext {
  // The address the caller used, from which the MCP endpoint's is built.
  origin: string;
  verify: (token: string) => Promise<AccountId>;
  store: Store;
  // Hands an ask left unsorted to the sort function again.
  sorts: SortRequests;
  // Reads the rules when they are saved.
  model: Model;
  log: Logger;
}

// How long after it was stored an ask may stay unsorted before a poll asks
// for it to be sorted again. A sort takes seconds, so this is long enough
// that a poll does not ask again while the first sort is still running.
export const sortRetryAfterMs = 60_000;

// The most asks one poll asks again for, so a poll is never held up long.
const sortRetriesPerPoll = 3;

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

const inMinutes = (minutes: number) =>
  minutes === 1 ? "a minute" : plural(minutes, "minute");

// Says what the limit is and how long to wait, from the limit's own
// constants (ADR 11).
function pollRefusal(secondsLeft: number): Response {
  return pageRefusal(
    "rate_limited",
    `The page polled more than ${String(pollLimit.polls)} times in ${inMinutes(pollLimit.windowMinutes)}, which is the limit for an account. Wait ${plural(secondsLeft, "second")}, then poll again.`,
  );
}

function rulesSaveRefusal(secondsLeft: number): Response {
  return pageRefusal(
    "rate_limited",
    `The rules were saved more than ${String(rulesSaveLimit.saves)} times in ${inMinutes(rulesSaveLimit.windowMinutes)}, which is the limit for an account. Wait ${plural(secondsLeft, "second")}, then save again.`,
  );
}

// The account's hashtags as the page shows them: in the rules' order, each
// with the colour it took when it first appeared.
const hashtagsOf = ({ hashtags, seen }: AccountRules) =>
  hashtags.map((name) => ({ name, colour: Math.max(0, seen.indexOf(name)) }));

const rulesView = (rules: AccountRules) =>
  rulesAnswer.parse({
    text: rules.text,
    hashtags: hashtagsOf(rules),
    readFailed: rules.readFailed,
  });

// Asks the sort function again for asks still unsorted a while after they
// were stored, as when sorting failed (PRD, "Back end"). Not posted: a
// replacing ask keeps the posting time of the one it replaces, so it would
// be asked for again while its first sort runs. An ask stored before the
// store recorded when counts from its posting time. Each one counts against
// the account's limit, so polling cannot spend the model's budget.
async function retryUnsorted(
  account: AccountId,
  asks: StoredAsk[],
  now: Date,
  { store, sorts, log }: PageContext,
): Promise<void> {
  const stale = asks
    .filter(
      (ask) =>
        ask.sort === undefined &&
        now.getTime() - Date.parse(ask.storedAt ?? ask.postedAt) >=
          sortRetryAfterMs,
    )
    .slice(0, sortRetriesPerPoll);
  // Asked for together, so a slow Lambda holds the poll up once, not once
  // for each ask.
  await Promise.all(
    stale.map(async (ask) => {
      const counted = await store.countSortRetry(account, now);
      if (!counted.counted) return;
      try {
        await sorts.request({ accountId: account, askId: ask.id });
        log.info("sort-retried", { accountId: account, askId: ask.id });
      } catch (error) {
        log.warn("sort-request-failed", {
          accountId: account,
          askId: ask.id,
          errorClass: errorClass(error),
        });
      }
    }),
  );
}

// The account's open asks, unless nothing changed since the version the
// poll carried. A poll with a bad version is refused before the table is
// touched. Every other poll counts against the account's limit first.
async function poll(
  request: Request,
  account: AccountId,
  context: PageContext,
): Promise<Response> {
  const { store, log } = context;
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
  const now = new Date();
  const counted = await store.countPoll(account, now);
  if (!counted.counted) {
    log.info("poll-limited", { accountId: account });
    return pollRefusal(counted.secondsLeft);
  }
  const found = await store.asksSince(account, since.data, now);
  if ("unchanged" in found) return answer(asksUnchanged.parse(found));
  const { version, everAsked, asks } = found;
  const rules = await store.rules(account);
  await retryUnsorted(account, asks, now, context);
  return answer(
    asksAnswer.parse({
      version,
      everAsked,
      hashtags: hashtagsOf(rules),
      asks: asks.map(({ id, summary, spokenDetail, postedAt, sort }) => ({
        id,
        summary,
        spokenDetail,
        postedAt,
        sort:
          sort === undefined
            ? null
            : { hashtags: sort.hashtags, level: sort.level },
      })),
    }),
  );
}

// Saves the rules, and reads the hashtags from them with a model call. If
// the model cannot read them, the text is still saved and the old hashtags
// stay, and the answer says so, so the page can offer to try again.
async function saveRules(
  request: Request,
  account: AccountId,
  { store, model, log }: PageContext,
): Promise<Response> {
  const input = rulesInput.safeParse(await jsonBody(request));
  if (!input.success) {
    log.info("input-invalid");
    return pageRefusal(
      "invalid_input",
      `Send the rules as JSON, as {"text": "..."}, with text of at most ${String(rulesLimit)} characters. Shorten them, then save again.`,
    );
  }
  const now = new Date();
  const counted = await store.countRulesSave(account, now);
  if (!counted.counted) {
    log.info("rules-limited", { accountId: account });
    return rulesSaveRefusal(counted.secondsLeft);
  }
  const { text } = input.data;
  let read: Awaited<ReturnType<typeof readHashtags>>;
  try {
    read = await readHashtags(text, model);
    if ("failed" in read) {
      log.warn("rules-read-failed", {
        accountId: account,
        errorClass: read.failed,
      });
    }
  } catch (error) {
    // Not the model's failure but askme's own, such as its key being
    // unreadable, so it alerts. The text is kept all the same.
    log.error("request-failed", { errorClass: errorClass(error) });
    read = { failed: errorClass(error) };
  }
  const saved = await store.saveRules(
    account,
    "failed" in read ? { text } : { text, hashtags: read.hashtags },
    now,
  );
  if (!("failed" in read)) log.info("rules-saved", { accountId: account });
  return answer(rulesView(saved));
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
    case "GET /api/rules":
      return answer(rulesView(await context.store.rules(account)));
    case "PUT /api/rules":
      return saveRules(request, account, context);
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
