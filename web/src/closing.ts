// The ask's own link keeps focus while the ask holds its place. If it left
// or moved, as following a link from its card sinks it, the next ask from
// when the card opened takes focus, so a person working down the list
// carries on from where they were.
export function focusOnClosing(
  card: string,
  stood: readonly string[],
  order: readonly string[],
): string | undefined {
  const at = new Map(order.map((id, index) => [id, index]));
  if (at.has(card) && heldPlace(card, stood, at)) return card;
  return (
    stood.slice(stood.indexOf(card) + 1).find((id) => at.has(id)) ??
    order.at(-1)
  );
}

// It held its place if every longest rising run of places takes it in, so
// leaving it out shortens the run. When its move and another's explain the
// new order as well, it moved.
function heldPlace(
  card: string,
  stood: readonly string[],
  at: ReadonlyMap<string, number>,
): boolean {
  const placesOf = (ids: readonly string[]) =>
    ids.flatMap((id) => at.get(id) ?? []);
  return (
    longestRise(placesOf(stood)) >
    longestRise(placesOf(stood.filter((id) => id !== card)))
  );
}

// The longest strictly rising subsequence. lowest[i] is the lowest place a
// run of length i + 1 can end on.
function longestRise(places: readonly number[]): number {
  const lowest: number[] = [];
  for (const place of places) {
    const longer = lowest.findIndex((end) => end >= place);
    if (longer < 0) lowest.push(place);
    else lowest[longer] = place;
  }
  return lowest.length;
}
