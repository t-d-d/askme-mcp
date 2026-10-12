import type { Hashtag, PageAsk } from "../../shared/page-api";
import type { AskActions } from "./actions";
import styles from "./AskList.module.css";
import type { Tab } from "./tab";
import { MoreAsks } from "./MoreAsks";
import { hashtagColours } from "./palette";
import { TopCard } from "./TopCard";
import { inListOrder } from "./waiting";

// One at a time: the ask that matters most, and of those the one that has
// waited longest, is large, and the rest wait below it, or beside it at
// desktop width. Ages are counted from now, when the list was read. The
// asks are the tab's, and take their colours from it.
//
// The top card is keyed by its ask, so when it is dismissed the next ask
// takes its place as a new card, not where the swipe left the old one.
export function AskList({
  asks,
  hashtags,
  tab,
  now,
  actions,
}: {
  asks: readonly PageAsk[];
  hashtags: Hashtag[];
  tab: Tab;
  now: number;
  actions: AskActions;
}) {
  const colours = hashtagColours(hashtags);
  const [first, ...rest] = inListOrder(asks);
  if (first === undefined) return null;
  return (
    <div className={styles.list}>
      <TopCard
        key={first.id}
        ask={first}
        tab={tab}
        now={now}
        colours={colours}
        actions={actions}
      />
      {rest.length > 0 && (
        <MoreAsks
          asks={rest}
          tab={tab}
          now={now}
          colours={colours}
          actions={actions}
        />
      )}
    </div>
  );
}
