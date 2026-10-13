import type { Hashtag, PageAsk } from "../../shared/page-api";
import type { AskActions } from "./actions";
import styles from "./AskList.module.css";
import type { Tab } from "./tab";
import { MoreAsks } from "./MoreAsks";
import { hashtagColours } from "./palette";
import { TopCard } from "./TopCard";

// The top card is keyed by its ask, so the next ask comes in as a new card,
// not where the swipe left the old one.
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
