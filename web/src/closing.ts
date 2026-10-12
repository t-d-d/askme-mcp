// Which ask's link takes focus as a card closes over the list
// (useListPlace.ts). Takes the ask whose card it was, the list's asks as
// they stood when the card opened, and the list's asks now, top card first.
//
// The ask's own link takes focus while the ask holds its place, so asks
// coming and going around it do not count, and nor do other asks moving
// past it. If it has left the list or moved in it, as following a link from
// its card sinks it, the ask that came after it takes focus, so a person
// working down the list carries on from where they were. With none of those
// left, the last ask in the list does, which is the top card when no row is
// left.
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

// Whether the ask held its place among the asks in both lists. The asks
// that kept their order are the longest run of them whose places now still
// rise. The ask held its place if every run that long takes it in. When its
// move and another ask's would explain the new order as well, it moved.
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

// The length of the longest run of places, in the order given, that rises.
// Each entry of lowest is the lowest place a run one longer than its index
// can end on, so the entries rise, and a place goes on the first entry not
// below it.
function longestRise(places: readonly number[]): number {
  const lowest: number[] = [];
  for (const place of places) {
    const longer = lowest.findIndex((end) => end >= place);
    if (longer < 0) lowest.push(place);
    else lowest[longer] = place;
  }
  return lowest.length;
}
