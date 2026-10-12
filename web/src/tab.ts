// The tabs over the list: which asks a tab lists, and which hashtag each
// ask is shown under there.

// The tab the list is on: one of the account's hashtags, by name, or
// Everything.
export type Tab = string | typeof everything;

export const everything = null;

// The asks a tab lists: every ask on Everything, and on a hashtag's tab only
// the asks sorted into that hashtag.
export function onTab<
  Ask extends { sort: { hashtags: readonly string[] } | null },
>(asks: readonly Ask[], tab: Tab): readonly Ask[] {
  return tab === everything
    ? asks
    : asks.filter((ask) => ask.sort?.hashtags.includes(tab) === true);
}

// The hashtag an ask is shown under, whose colour its buttons take: its
// first, in the rules' order, on Everything, and the tab's own on a
// hashtag's tab (docs/design.md, "Colour rules").
export function shownUnder(
  sort: { hashtags: readonly string[] },
  tab: Tab,
): string | undefined {
  return tab ?? sort.hashtags[0];
}
