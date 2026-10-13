// The routes the signed-in page calls.
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
import { pageRefusal, unavailable } from "./errors";
import { authorizationOf, jsonBody } from "./http";
import { AgentToken, TokenRejected, type AccountId } from "./identity";
import { queueSorts, type SortRequests } from "./jobs";
import { errorClass, type Logger } from "./log";
import { CapReached, modelFaultIsOurs, type CountedModel } from "./model";
import { rateLimits } from "./rate";
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
import { countPer, timesIn, waitFor } from "./wording";

export interface PageContext {
  origin: string;
  verify: (token: string) => Promise<AccountId>;
  store: Store;
  sorts: SortRequests;
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

const sinceSchema = z
  .string()
  .regex(/^\d{1,15}$/u)
  .transform(Number)
  .optional();

function pollRefusal(secondsLeft: number): Response {
  return pageRefusal(
    "rate_limited",
    `The page polled more than ${timesIn(rateLimits.poll)}, which is the limit for an account. ${waitFor(secondsLeft)}, then poll again.`,
  );
}

function rulesSaveRefusal(secondsLeft: number): Response {
  return pageRefusal(
    "rate_limited",
    `The rules were saved more than ${timesIn(rateLimits.rulesSave)}, which is the limit for an account. ${waitFor(secondsLeft)}, then save again.`,
  );
}

function modelCapRefusal(resetsAt: Date): Response {
  return pageRefusal(
    "cap_reached",
    `Saving these rules needs model calls, to read them or to sort the asks again, and this account has made the ${String(rateLimits.modelCall.limit)} model calls askme makes for an account in a day. Nothing was saved. The count starts again at ${resetsAt.toISOString()}, midnight UTC. Save the rules again after then.`,
  );
}

function samplesRateRefusal(secondsLeft: number): Response {
  return pageRefusal(
    "rate_limited",
    `This account is posting asks too fast. askme takes at most ${countPer(rateLimits.ask, "asks")}, sample asks included. ${waitFor(secondsLeft)}, then send sample asks again.`,
  );
}

function samplesCapRefusal(resetsAt: Date): Response {
  return pageRefusal(
    "cap_reached",
    `This account has posted ${String(dailyAskCap)} asks today, sample asks included, which is as many as askme takes in a day. The count starts again at ${resetsAt.toISOString()}, midnight UTC. Send sample asks again after then.`,
  );
}

function samplesSentRefusal(): Response {
  return pageRefusal(
    "rate_limited",
    `Every sample ask was sent in the last ${String(dedupeWindowMinutes)} minutes, and sending one again would show nothing new. Wait a few minutes, then send sample asks again.`,
  );
}

// A failure here still lets the save succeed. The asks then show as
// stopped once their time is up.
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

// A poll only reads. It never queues a sort (ADR 22).
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
  const counted = await store.countCall(account, "poll", now);
  if (!counted.counted) {
    log.info("poll-limited", { accountId: account });
    return pollRefusal(counted.secondsLeft);
  }
  const found = await store.asksSince(account, since.data, now);
  if ("unchanged" in found) return answer(asksUnchanged.parse(found));
  return answer(asksView(found, await store.rules(account), now));
}

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
  const counted = await store.countCall(account, "rulesSave", now);
  if (!counted.counted) {
    log.info("rules-limited", { accountId: account });
    return rulesSaveRefusal(counted.secondsLeft);
  }
  const { text, timeZone } = input.data;
  // Checked before the resave too: unchanged text is not read again, but
  // the sorts it queues need model calls (ADR 21). Empty rules need none.
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
      // The model refused askme's own key or settings, so it alerts.
      if (modelFaultIsOurs(read.failed)) {
        log.error("request-failed", { errorClass: read.failed });
      }
    }
  } catch (error) {
    // The cap ran out after the check above, so refuse as that check would.
    if (error instanceof CapReached) {
      log.info("rules-capped", { accountId: account });
      return modelCapRefusal(error.resetsAt);
    }
    // askme's own failure, such as an unreadable key, so it alerts. The text
    // is still saved.
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

type AskChangeKind = "opened" | "dismissed";

// No rate limit on purpose. Only an ask's first opening and its dismissal
// write, and the daily cap bounds the asks. A counter would add a write to
// every call, so a flood would cost more with a limit than without one.
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
