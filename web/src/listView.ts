import type { AsksAnswer, Hashtag, PageAsk } from "../../shared/page-api";
import { heldAsks } from "./hours";
import { clockTime } from "./resets";
import { capSpentUntil, sortingLine, sortingState } from "./sorting";
import { everything, onTab, type Tab } from "./tab";
import { inListOrder, lapsedAsks } from "./waiting";

export interface ListViewInput {
  answer: AsksAnswer | undefined;
  // On this browser's clock.
  polledAt: number;
  serviceAhead: number;
  dismissed: ReadonlySet<string>;
  opened: ReadonlySet<string>;
  card: string | null;
  chosen: Tab;
  showingHeld: boolean;
  showingLapsed: boolean;
}

export interface ListView {
  asks: readonly PageAsk[];
  open: PageAsk | undefined;
  tab: Tab;
  shown: readonly PageAsk[];
  heldHere: number;
  lapsedHere: number;
  allClear: boolean;
  sorting: string | null;
  coloured: Hashtag[];
  // False once none is held, or lapsed, so the next one is hidden again.
  keepHeld: boolean;
  keepLapsed: boolean;
}

export function listView({
  answer,
  polledAt,
  serviceAhead,
  dismissed,
  opened,
  card,
  chosen,
  showingHeld,
  showingLapsed,
}: ListViewInput): ListView {
  const polled = answer?.asks ?? [];
  const asks = polled
    .filter(({ id }) => !dismissed.has(id))
    .map((ask) => (opened.has(ask.id) ? { ...ask, opened: true } : ask));
  const hashtags = answer?.hashtags ?? [];
  const coloured =
    answer === undefined ? [] : [...hashtags, ...answer.formerHashtags];
  // Over the list as polled, so a dismissed ask counts until askme drops it,
  // and Undo brings it back as it was.
  const lapsed = lapsedAsks(polled, polledAt, serviceAhead);
  const held = heldAsks(
    polled.filter(({ id }) => !lapsed.has(id)),
    hashtags,
    answer?.timeZone,
    polledAt,
  );
  const capResets = capSpentUntil(
    answer?.modelCapResetsAt,
    polledAt,
    serviceAhead,
  );
  // Counted over the list after dismissals made here.
  const sorting = sortingLine(
    sortingState(asks, polledAt, serviceAhead),
    capResets === null ? null : clockTime(capResets),
  );
  const waiting = (list: readonly PageAsk[]) =>
    list.filter(
      ({ id }) =>
        (showingHeld || !held.has(id)) && (showingLapsed || !lapsed.has(id)),
    );
  const open = card === null ? undefined : asks.find(({ id }) => id === card);
  // An open card keeps the list's tab, though every ask behind it is held or
  // lapsed.
  const allClear =
    open === undefined &&
    answer?.everAsked === true &&
    waiting(asks).length === 0;
  const tab =
    !allClear && hashtags.some(({ name }) => name === chosen)
      ? chosen
      : everything;
  const onThisTab = onTab(asks, tab);
  return {
    asks,
    open,
    tab,
    shown: inListOrder(waiting(onThisTab), polledAt, serviceAhead),
    heldHere: onThisTab.filter(({ id }) => held.has(id)).length,
    lapsedHere: onThisTab.filter(({ id }) => lapsed.has(id)).length,
    allClear,
    sorting,
    coloured,
    keepHeld: showingHeld && held.size > 0,
    keepLapsed: showingLapsed && lapsed.size > 0,
  };
}
