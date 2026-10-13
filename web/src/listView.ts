// What the main screen's list shows, worked out from the poll's answer and
// what the person has done on this page: the asks it holds, the open card,
// the tab, the asks shown on it, the held and lapsed counts, whether it is
// all clear, and the sorting line (Asks.tsx says how each reads). The
// service gives its times by its own clock, serviceAhead ahead of this
// browser's (load.ts).
import type { AsksAnswer, Hashtag, PageAsk } from "../../shared/page-api";
import { heldAsks } from "./hours";
import { clockTime } from "./resets";
import { capSpentUntil, sortingLine, sortingState } from "./sorting";
import { everything, onTab, type Tab } from "./tab";
import { inListOrder, lapsedAsks } from "./waiting";

export interface ListViewInput {
  // The poll's answer, or undefined before the first.
  answer: AsksAnswer | undefined;
  // When the answer was polled, on this browser's clock.
  polledAt: number;
  serviceAhead: number;
  // The asks dismissed and opened on this page, by id.
  dismissed: ReadonlySet<string>;
  opened: ReadonlySet<string>;
  // The ask the address names, if any.
  card: string | null;
  // The tab the person chose, and whether held and lapsed asks are showing.
  chosen: Tab;
  showingHeld: boolean;
  showingLapsed: boolean;
}

export interface ListView {
  // The asks as polled, less those dismissed here, with those opened here
  // marked opened.
  asks: readonly PageAsk[];
  // The ask whose card is open, if the list holds it.
  open: PageAsk | undefined;
  // The tab the list is on, which the chosen tab follows.
  tab: Tab;
  // The asks shown on the tab, in list order.
  shown: readonly PageAsk[];
  // How many of the tab's asks are held, and how many lapsed.
  heldHere: number;
  lapsedHere: number;
  allClear: boolean;
  // The sorting line's words, or null when there is no line.
  sorting: string | null;
  // Every hashtag an ask may carry, the former ones included, for colour.
  coloured: Hashtag[];
  // Whether held, and lapsed, asks stay showing: once none is, they are
  // hidden again when they are next held or lapsed.
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
  // Counted over the list as polled, so an ask dismissed here still counts
  // until askme drops it, and Undo brings it back as it was. A lapsed ask is
  // not held, and only the rules' own hashtags have hours.
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
