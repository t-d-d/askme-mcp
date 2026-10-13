import { asksAnswer, rulesAnswer } from "../../shared/page-api";
import type { AccountAsks, AccountRules, StoredAsk } from "./store/store";

// Longer than three deliveries six minutes apart take, with room for a
// queue working through a save.
export const sortingMs = 30 * 60_000;

export const sortedWithRules = (
  { sort }: Pick<StoredAsk, "sort">,
  { version }: Pick<AccountRules, "version">,
): boolean => sort !== undefined && sort.rulesVersion >= version;

// A hashtag keeps the colour it took when it first appeared.
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

// Nothing is written when this time passes, so the page works out the state
// from it (ADR 22). Not from postedAt: a replacing ask keeps the posting
// time of the ask it replaces.
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

export const rulesView = (rules: AccountRules) =>
  rulesAnswer.parse({
    text: rules.text,
    hashtags: hashtagsOf(rules),
    readFailed: rules.readFailed,
    timeZone: rules.timeZone,
  });

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
