// The page's API: the routes the signed-in page calls (ADR 6). Each one
// verifies a session token and takes the account from it, never from the
// request. An agent's token is refused, because an agent reads nothing
// (ADR 2). A refusal uses the codes of the error contract (ADR 11), and only
// a missing or bad token is refused with a bare 401.
import { z } from "zod";
import {
  askChange,
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
  // Hands asks to the sort function: every open ask when the rules are
  // saved, and any a poll finds still waiting for a sort.
  sorts: SortRequests;
  // Reads the rules when they are saved.
  model: Model;
  log: Logger;
}

// How long after an ask was last handed to the sort function it may wait
// for a sort before a poll asks again. A sort takes seconds, so this is
// long enough that a poll does not ask again while the first sort is still
// running.
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
const hashtagsOf = ({
  hashtags,
  seen,
}: Pick<AccountRules, "hashtags" | "seen">) =>
  hashtags.map((name) => ({ name, colour: Math.max(0, seen.indexOf(name)) }));

// The hashtags open asks still carry that the rules no longer name, because
// they have not been sorted again since the rules changed. Each keeps the
// colour it took when it first appeared.
function formerHashtagsOf({ hashtags, seen }: AccountRules, asks: StoredAsk[]) {
  const carried = new Set(asks.flatMap(({ sort }) => sort?.hashtags ?? []));
  return hashtagsOf({
    hashtags: seen.filter(
      (name) => carried.has(name) && !hashtags.includes(name),
    ),
    seen,
  });
}

const rulesView = (rules: AccountRules) =>
  rulesAnswer.parse({
    text: rules.text,
    hashtags: hashtagsOf(rules),
    readFailed: rules.readFailed,
  });

// Hands one ask to the sort function, and says whether Lambda took it. When
// it did not, the ask keeps what it has, unsorted or its old sort, and a
// later poll asks again.
async function handOn(
  account: AccountId,
  askId: string,
  { sorts, log }: PageContext,
): Promise<boolean> {
  try {
    await sorts.request({ accountId: account, askId });
    return true;
  } catch (error) {
    log.warn("sort-request-failed", {
      accountId: account,
      askId,
      errorClass: errorClass(error),
    });
    return false;
  }
}

// When an ask was last handed to the sort function: when it was stored, or
// when the rules were last saved, which hands on every open ask. Not when
// it was posted: a replacing ask keeps the posting time of the one it
// replaces, so it would be asked for again while its first sort runs.
const handedOnAt = (ask: StoredAsk, { savedAt }: AccountRules) =>
  Math.max(
    Date.parse(ask.storedAt),
    savedAt === undefined ? 0 : Date.parse(savedAt),
  );

// Asks the sort function again for asks still not sorted with the rules in
// force a while after they were last handed to it, as when sorting failed
// (PRD, "Back end"). That is an ask not sorted yet, or one sorted with
// rules saved before. Each one counts against the account's limit, so
// polling cannot spend the model's budget.
async function sortAgain(
  account: AccountId,
  asks: StoredAsk[],
  rules: AccountRules,
  now: Date,
  context: PageContext,
): Promise<void> {
  const { store, log } = context;
  const waiting = asks
    .filter(
      (ask) =>
        (ask.sort === undefined || ask.sort.rulesVersion < rules.version) &&
        now.getTime() - handedOnAt(ask, rules) >= sortRetryAfterMs,
    )
    .slice(0, sortRetriesPerPoll);
  // Asked for together, so a slow Lambda holds the poll up once, not once
  // for each ask.
  await Promise.all(
    waiting.map(async (ask) => {
      const counted = await store.countSortRetry(account, now);
      if (!counted.counted) return;
      if (await handOn(account, ask.id, context)) {
        log.info("sort-retried", { accountId: account, askId: ask.id });
      }
    }),
  );
}

// Hands every open ask to the sort function, to be sorted with the rules
// just saved (PRD, "Rules"). Each keeps its old sort, and so its old
// hashtags, until the new one is stored. A failure here is askme's own,
// such as the table failing, so it alerts. The rules are saved all the
// same, and a poll asks again for the asks a while later.
async function sortAllAgain(
  account: AccountId,
  now: Date,
  context: PageContext,
): Promise<void> {
  try {
    const { asks } = await context.store.openAsks(account, now);
    // Handed on together, so the save waits for Lambda once, not once for
    // each ask.
    await Promise.all(asks.map((ask) => handOn(account, ask.id, context)));
  } catch (error) {
    context.log.error("request-failed", { errorClass: errorClass(error) });
  }
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
  await sortAgain(account, asks, rules, now, context);
  return answer(
    asksAnswer.parse({
      version,
      everAsked,
      hashtags: hashtagsOf(rules),
      formerHashtags: formerHashtagsOf(rules, asks),
      asks: asks.map((ask) => ({
        id: ask.id,
        summary: ask.summary,
        spokenDetail: ask.spokenDetail,
        actionLink: ask.actionLink,
        sessionLink: ask.sessionLink,
        postedAt: ask.postedAt,
        opened: ask.openedAt !== undefined,
        sort:
          ask.sort === undefined
            ? null
            : {
                hashtags: ask.sort.hashtags,
                level: ask.sort.level,
                reason: ask.sort.reason,
              },
      })),
    }),
  );
}

// Saves the rules, and reads the hashtags from them with a model call. If
// the model cannot read them, the text is still saved and the old hashtags
// stay, and the answer says so, so the page can offer to try again. Either
// way, every open ask is then sorted again.
async function saveRules(
  request: Request,
  account: AccountId,
  context: PageContext,
): Promise<Response> {
  const { store, model, log } = context;
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
  await sortAllAgain(account, now, context);
  return answer(rulesView(saved));
}

// What the person did to an ask from the page.
type AskChangeKind = "opened" | "dismissed";

// Marks an ask as opened, or dismisses it, by the id in the body. A repeat
// changes nothing and succeeds, and so does a change to an ask its agent
// has closed meanwhile. An id the account has no ask for, another
// account's included, is refused as not_found.
async function changeAsk(
  kind: AskChangeKind,
  request: Request,
  account: AccountId,
  { store, log }: PageContext,
): Promise<Response> {
  const input = askChange.safeParse(await jsonBody(request));
  if (!input.success) {
    log.info("input-invalid");
    return pageRefusal(
      "invalid_input",
      `Send the ask's id as JSON, as {"id": "..."}, exactly as the list gave it, with nothing else. Then send it again.`,
    );
  }
  const { id } = input.data;
  const now = new Date();
  const done =
    kind === "opened"
      ? await store.markOpened(account, id, now)
      : await store.dismissAsk(account, id, now);
  switch (done) {
    case "opened":
      log.info("ask-opened", { accountId: account, askId: id });
      break;
    case "dismissed":
      log.info("ask-dismissed", { accountId: account, askId: id });
      break;
    case "unchanged":
      break;
    case "not-found":
      log.info("ask-not-found", { accountId: account });
      return pageRefusal(
        "not_found",
        "The account has no ask with this id. It may have expired. Load the list again, and do not retry.",
      );
  }
  return new Response(null, { status: 204, headers: noStore });
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
    case "POST /api/asks/opened":
      return changeAsk("opened", request, account, context);
    case "POST /api/asks/dismissed":
      return changeAsk("dismissed", request, account, context);
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
