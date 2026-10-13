export type Tab = string | typeof everything;

export const everything = null;

export function onTab<
  Ask extends { sort: { hashtags: readonly string[] } | null },
>(asks: readonly Ask[], tab: Tab): readonly Ask[] {
  return tab === everything
    ? asks
    : asks.filter((ask) => ask.sort?.hashtags.includes(tab) === true);
}

// sort.hashtags is in the rules' order (docs/design.md, "Colour rules").
export function shownUnder(
  sort: { hashtags: readonly string[] },
  tab: Tab,
): string | undefined {
  return tab ?? sort.hashtags[0];
}
