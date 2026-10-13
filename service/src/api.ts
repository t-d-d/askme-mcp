// The page's API: the routes the signed-in page calls (ADR 6). Each one
// verifies a session token and takes the account from it, never from the
// request. An agent's token is refused, because an agent reads nothing
// (ADR 2). A refusal uses the codes of the error contract (ADR 11), and only
// a missing or bad token is refused with a bare 401.
import { z } from "zod";
import {
  askChange,
  askIdLimit,
  asksUnchanged,
  connectionAnswer,
  rulesInput,
  rulesLimit,
  sinceParam,
} from "../../shared/page-api";
import { pageRefusal } from "./errors";
import { authorizationOf, jsonBody } from "./http";
import { AgentToken, TokenRejected, type AccountId } from "./identity";
import { queueSorts, type SortRequests } from "./jobs";
import { errorClass, type Logger } from "./log";
import { CapReached, type CountedModel } from "./model";
import { askLimit, modelCallLimit, pollLimit, rulesSaveLimit } from "./rate";
import { mcpPath, type PageRoute } from "./routes";
import { emptyRules, readRules } from "./rules";
import { sendSamples } from "./samples";
import {
  dailyAskCap,
  dedupeWindowMinutes,
  type AccountRules,
  type Store,
} from "./store/store";
import { asksView, rulesView, sortedWithRules } from "./view";

export interface PageContext {
  // The address the caller used, from which the MCP endpoint's is built.
  origin: string;
  verify: (token: string) => Promise<AccountId>;
  store: Store;
  // Queues asks' sorts: the open asks when the rules are saved, and each
  // sample ask. A poll queues none (ADR 22).
  sorts: SortRequests;
  // Reads the rules when they are saved, counting each call against the
  // account's daily cap.
  model: CountedModel;
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

// A save refused at the daily cap on model calls (ADR 21), which says when
// the count starts again, as the ask cap's refusal does.
function modelCapRefusal(resetsAt: Date): Response {
  return pageRefusal(
    "cap_reached",
    `Saving these rules needs model calls, to read them or to sort the asks again, and this account has made the ${String(modelCallLimit.calls)} model calls askme makes for an account in a day. Nothing was saved. The count starts again at ${resetsAt.toISOString()}, midnight UTC. Save the rules again after then.`,
  );
}

function samplesRateRefusal(secondsLeft: number): Response {
  const perWindow =
    askLimit.windowMinutes === 1
      ? "a minute"
      : `in ${inMinutes(askLimit.windowMinutes)}`;
  return pageRefusal(
    "rate_limited",
    `This account is posting asks too fast. askme takes at most ${String(askLimit.asks)} asks ${perWindow}, sample asks included. Wait ${plural(secondsLeft, "second")}, then send sample asks again.`,
  );
}

function samplesCapRefusal(resetsAt: Date): Response {
  return pageRefusal(
    "cap_reached",
    `This account has posted ${String(dailyAskCap)} asks today, sample asks included, which is as many as askme takes in a day. The count starts again at ${resetsAt.toISOString()}, midnight UTC. Send sample asks again after then.`,
  );
}

// Every sample was posted in the last ten minutes, so posting one again
// would only be matched to it (ADR 3).
function samplesSentRefusal(): Response {
  return pageRefusal(
    "rate_limited",
    `Every sample ask was sent in the last ${String(dedupeWindowMinutes)} minutes, and sending one again would show nothing new. Wait a few minutes, then send sample asks again.`,
  );
}

// Queues a sort of the open asks after the rules are saved (PRD, "Rules"):
// every one when the rules were read again, or only the asks behind them
// when the text was saved unchanged. Each ask keeps its old sort, and so
// its old hashtags, until the new one is stored. A failure here is askme's
// own, such as the table failing, so it alerts. The rules are saved all the
// same, and the asks show as stopped once their time is up.
async function sortAfterSave(
  account: AccountId,
  rules: AccountRules,
  every: boolean,
  now: Date,
  context: PageContext,
): Promise<void> {
  try {
    const { asks } = await context.store.openAsks(account, now);
    const queued = every
      ? asks
      : asks.filter((ask) => !sortedWithRules(ask, rules));
    await queueSorts(
      context,
      account,
      queued.map(({ id }) => id),
      now,
    );
  } catch (error) {
    context.log.error("request-failed", { errorClass: errorClass(error) });
  }
}

// The account's open asks, unless nothing changed since the version the
// poll carried. A poll with a bad version is refused before the table is
// touched. Every other poll counts against the account's limit first. A
// poll only reads: it never queues a sort (ADR 22). It gives each ask behind
// the rules the time it turns stopped instead, and when the daily cap on
// model calls resets, while that time is still ahead.
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
  return answer(asksView(found, await store.rules(account), now));
}

// Saves the rules and the time zone they were written in, and reads the
// hashtags and their hours from them with a model call. If the model cannot
// read them, the text is still saved and the old hashtags and hours stay,
// and the answer says so, so the page can offer to try again. Either way,
// every open ask is then sorted again.
//
// A save of the text the rules already hold, whose last reading succeeded,
// reads nothing and leaves the rules version alone (ADR 22). It records
// when it was made, and queues only the asks still behind the rules, such
// as those whose sorting stopped. "Try again" after a failed reading sends
// the same text, and reads it again, as any other save does.
//
// While the account's daily cap on model calls is spent, a save is refused
// with cap_reached before anything is saved (ADR 21): one that reads the
// rules needs a call, and one of unchanged text queues sorts that do
// (ADR 22). Empty rules sort with no call, so their save is never refused.
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
      `Send the rules as JSON, as {"text": "...", "timeZone": "Europe/London"}. The text may hold at most ${String(rulesLimit)} characters, and the time zone, which may be left out, must be a name from the IANA list. Fix the request, then save again.`,
    );
  }
  const now = new Date();
  const counted = await store.countRulesSave(account, now);
  if (!counted.counted) {
    log.info("rules-limited", { accountId: account });
    return rulesSaveRefusal(counted.secondsLeft);
  }
  const { text, timeZone } = input.data;
  if (!emptyRules(text)) {
    const resetsAt = await model.spent(account);
    if (resetsAt !== undefined) {
      log.info("rules-capped", { accountId: account });
      return modelCapRefusal(resetsAt);
    }
  }
  const resaved = await store.resaveRules(account, { text, timeZone }, now);
  if (resaved !== undefined) {
    log.info("rules-resaved", { accountId: account });
    await sortAfterSave(account, resaved, false, now, context);
    return answer(rulesView(resaved));
  }
  let read: Awaited<ReturnType<typeof readRules>>;
  try {
    read = await readRules(text, model.forAccount(account));
    if ("failed" in read) {
      log.warn("rules-read-failed", {
        accountId: account,
        errorClass: read.failed,
      });
    }
  } catch (error) {
    // The cap ran out after the check above, so nothing was sent, and the
    // save is refused as it would have been there.
    if (error instanceof CapReached) {
      log.info("rules-capped", { accountId: account });
      return modelCapRefusal(error.resetsAt);
    }
    // Not the model's failure but askme's own, such as its key being
    // unreadable, so it alerts. The text is kept all the same.
    log.error("request-failed", { errorClass: errorClass(error) });
    read = { failed: errorClass(error) };
  }
  const saved = await store.saveRules(
    account,
    "failed" in read
      ? { text, timeZone }
      : { text, timeZone, hashtags: read.hashtags, hours: read.hours },
    now,
  );
  if (!("failed" in read)) log.info("rules-saved", { accountId: account });
  await sortAfterSave(account, saved, true, now, context);
  return answer(rulesView(saved));
}

// Posts one sample ask from each of three areas, as an agent would, and
// queues each one's sort, so sorting can be watched with no agent
// connected (PRD, "Web page"). Each counts against the account's rate and
// its daily cap. A limit reached part way keeps the asks posted before it,
// and the refusal says which limit it was.
async function postSamples(
  account: AccountId,
  context: PageContext,
): Promise<Response> {
  const { store, log } = context;
  const now = new Date();
  const { posted, refused } = await sendSamples(account, store, now);
  for (const askId of posted) {
    log.info("sample-posted", { accountId: account, askId });
  }
  await queueSorts(context, account, posted, now);
  if (refused === undefined) {
    if (posted.length > 0) {
      return new Response(null, { status: 204, headers: noStore });
    }
    log.info("rate-limited", { accountId: account });
    return samplesSentRefusal();
  }
  switch (refused.kind) {
    case "rate-limited":
      log.info("rate-limited", { accountId: account });
      return samplesRateRefusal(refused.secondsLeft);
    case "over-cap":
      log.info("cap-reached", { accountId: account });
      return samplesCapRefusal(refused.resetsAt);
  }
}

// What the person did to an ask from the page.
type AskChangeKind = "opened" | "dismissed";

// Marks an ask as opened, or dismisses it, by the id in the body. A repeat
// changes nothing and succeeds, and so does a change to an ask its agent
// has closed meanwhile. An id the account has no ask for, another
// account's included, is refused as not_found.
//
// Neither change has a rate limit, as the owner decided in issue #96. Only
// an ask's first opening and its dismissal write, so these calls raise the
// version at most twice for each ask, and the daily cap limits the asks.
// Any other call reads at most two items and changes nothing. A call that
// writes, or tries to, can also send up to writeTries refused transactions,
// for the reasons given on writeTries in the store. A counter would add a
// write to every call, a refused one included, so a flood would cost more
// with a limit than without one.
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
      `Send the ask's id as JSON, as {"id": "..."}, exactly as the list gave it: at most ${String(askIdLimit)} letters, digits, - or _, with nothing else. Then send it again.`,
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
    case "POST /api/asks/samples":
      return postSamples(account, context);
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
