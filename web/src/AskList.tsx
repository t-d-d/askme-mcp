import type { Hashtag, PageAsk } from "../../shared/page-api";
import type { AskActions } from "./actions";
import styles from "./AskList.module.css";
import type { Tab } from "./tab";
import { MoreAsks } from "./MoreAsks";
import { hashtagColours } from "./palette";
import { TopCard } from "./TopCard";

// One at a time: the ask that matters most, and of those the one that has
// waited longest, is large, and the rest wait below it, or beside it at
// desktop width. Ages are counted to now, when the list was read, by the
// service's clock, serviceAhead ahead of this browser's. The asks are the
// tab's, in list order, and take their colours from it.
//
// The top card is keyed by its ask, so when it is dismissed the next ask
// takes its place as a new card, not where the swipe left the old one.
export function AskList({
  asks,
  hashtags,
  tab,
  now,
  serviceAhead,
  actions,
}: {
  asks: readonly PageAsk[];
  hashtags: Hashtag[];
  tab: Tab;
  now: number;
  serviceAhead: number;
  actions: AskActions;
}) {
  const colours = hashtagColours(hashtags);
  const [first, ...rest] = asks;
  if (first === undefined) return null;
  return (
    <div className={styles.list}>
      <TopCard
        key={first.id}
        ask={first}
        tab={tab}
        now={now}
        serviceAhead={serviceAhead}
        colours={colours}
        actions={actions}
      />
      <MoreAsks
        asks={rest}
        tab={tab}
        now={now}
        serviceAhead={serviceAhead}
        colours={colours}
        actions={actions}
      />
    </div>
  );
}
