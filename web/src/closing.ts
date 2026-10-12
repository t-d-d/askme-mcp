// Which ask's link takes focus as a card closes over the list
// (useListPlace.ts). Takes the ask whose card it was, the list's asks as
// they stood when the card opened, and the list's asks now, top card first.
//
// The ask's own link takes focus while the ask holds its place among the
// asks in both lists, so asks coming and going around it do not count. If
// it has left the list or moved in it, as following a link from its card
// sinks it, the ask that came after it takes focus, so a person working down
// the list carries on from where they were. With none of those left, the
// last ask in the list does, which is the top card when no row is left.
export function focusOnClosing(
  card: string,
  stood: readonly string[],
  order: readonly string[],
): string | undefined {
  const kept = stood.filter((id) => order.includes(id));
  const now = order.filter((id) => stood.includes(id));
  if (order.includes(card) && kept.indexOf(card) === now.indexOf(card)) {
    return card;
  }
  return (
    stood.slice(stood.indexOf(card) + 1).find((id) => order.includes(id)) ??
    order.at(-1)
  );
}
