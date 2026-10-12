import type { Hashtag, PageAsk } from "../../shared/page-api";
import styles from "./AskList.module.css";
import { inListOrder, type Tab } from "./asks";
import { MoreAsks } from "./MoreAsks";
import { hashtagColours } from "./palette";
import { TopCard } from "./TopCard";

// One at a time: the ask that matters most, and of those the one that has
// waited longest, is large, and the rest wait below it, or beside it at
// desktop width. Ages are counted from now, when the list was read. The
// asks are the tab's, and take their colours from it.
export function AskList({
  asks,
  hashtags,
  tab,
  now,
}: {
  asks: readonly PageAsk[];
  hashtags: Hashtag[];
  tab: Tab;
  now: number;
}) {
  const colours = hashtagColours(hashtags);
  const [first, ...rest] = inListOrder(asks);
  if (first === undefined) return null;
  return (
    <div className={styles.list}>
      <TopCard ask={first} tab={tab} now={now} colours={colours} />
      {rest.length > 0 && (
        <MoreAsks asks={rest} tab={tab} now={now} colours={colours} />
      )}
    </div>
  );
}
