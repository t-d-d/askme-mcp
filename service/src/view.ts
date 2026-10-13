// What the page sees of an account's asks and rules: pure functions of what
// the store holds and the time. Nothing here reaches the table, the queue or
// the model. The page's API reads the store and answers with these (ADR 6).
import { asksAnswer, rulesAnswer } from "../../shared/page-api";
import type { AccountAsks, AccountRules, StoredAsk } from "./store/store";

// How long an ask behind the rules counts as sorting, from the later of when
// it was stored and the last save. That is longer than three deliveries six
// minutes apart take, with room for a queue working through a save. After
// it, the ask counts as stopped, and a save of the rules queues it again.
export const sortingMs = 30 * 60_000;

// Whether an ask is sorted with the rules in force: sorted, with the rules
// version a save last raised them to, or a later one. Any other ask is
// behind the rules. The sorter skips an ask that is sorted with them, and
// the poll gives one behind them the time it turns stopped (ADR 22).
export const sortedWithRules = (
  { sort }: Pick<StoredAsk, "sort">,
  { version }: Pick<AccountRules, "version">,
): boolean => sort !== undefined && sort.rulesVersion >= version;

// The account's hashtags as the page shows them: in the rules' order, each
// with the colour it took when it first appeared, and the windows of its
// hours when the rules give it any.
export const hashtagsOf = ({
  hashtags,
  seen,
  hours,
}: Pick<AccountRules, "hashtags" | "seen" | "hours">) =>
  hashtags.map((name) => {
    const windows = (hours ?? [])
      .filter(({ hashtag }) => hashtag === name)
      .map(({ days, from, to }) => ({ days, from, to }));
    return {
      name,
      colour: Math.max(0, seen.indexOf(name)),
      ...(windows.length === 0 ? {} : { hours: windows }),
    };
  });

// The hashtags open asks still carry that the rules no longer name, because
// they have not been sorted again since the rules changed. Each keeps the
// colour it took when it first appeared.
export function formerHashtagsOf(
  { hashtags, seen }: Pick<AccountRules, "hashtags" | "seen">,
  asks: Pick<StoredAsk, "sort">[],
) {
  const carried = new Set(asks.flatMap(({ sort }) => sort?.hashtags ?? []));
  return hashtagsOf({
    hashtags: seen.filter(
      (name) => carried.has(name) && !hashtags.includes(name),
    ),
    seen,
  });
}

// When an ask behind the rules turns from sorting to stopped (ADR 22): half
// an hour after the later of when it was stored and the last save, either
// of which queued it. Not when it was posted: a replacing ask keeps the
// posting time of the ask it replaces. Nothing is written when the time
// passes, so the page works the state out from it. An ask sorted with the
// rules in force has none.
export function sortingUntil(
  ask: Pick<StoredAsk, "sort" | "storedAt">,
  rules: Pick<AccountRules, "version" | "savedAt">,
) {
  if (sortedWithRules(ask, rules)) return undefined;
  const queued = Math.max(
    Date.parse(ask.storedAt),
    rules.savedAt === undefined ? 0 : Date.parse(rules.savedAt),
  );
  return new Date(queued + sortingMs).toISOString();
}

// The rules as the page shows them.
export const rulesView = (rules: AccountRules) =>
  rulesAnswer.parse({
    text: rules.text,
    hashtags: hashtagsOf(rules),
    readFailed: rules.readFailed,
    timeZone: rules.timeZone,
  });

// The poll's full answer: the account's open asks with the rules in force,
// at a moment. Each ask behind the rules carries the time it turns stopped,
// and the answer carries when the daily cap on model calls resets, while
// that time is still ahead.
export function asksView(
  { version, everAsked, asks, modelCapResetsAt }: AccountAsks,
  rules: AccountRules,
  now: Date,
) {
  return asksAnswer.parse({
    version,
    everAsked,
    hashtags: hashtagsOf(rules),
    formerHashtags: formerHashtagsOf(rules, asks),
    timeZone: rules.timeZone,
    modelCapResetsAt:
      modelCapResetsAt !== undefined &&
      Date.parse(modelCapResetsAt) > now.getTime()
        ? modelCapResetsAt
        : undefined,
    asks: asks.map((ask) => ({
      id: ask.id,
      summary: ask.summary,
      spokenDetail: ask.spokenDetail,
      actionLink: ask.actionLink,
      sessionLink: ask.sessionLink,
      postedAt: ask.postedAt,
      lapsesAt: ask.lapsesAt,
      opened: ask.openedAt !== undefined,
      sortingUntil: sortingUntil(ask, rules),
      sort:
        ask.sort === undefined
          ? null
          : {
              hashtags: ask.sort.hashtags,
              level: ask.sort.level,
              reason: ask.sort.reason,
            },
    })),
  });
}
