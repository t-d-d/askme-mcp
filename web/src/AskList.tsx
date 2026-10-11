import type { PageAsk } from "../../shared/page-api";
import styles from "./AskList.module.css";
import { longestWaitingFirst } from "./asks";
import { MoreAsks } from "./MoreAsks";
import { TopCard } from "./TopCard";

// One at a time: the ask that has waited longest is large, and the rest
// wait below it, or beside it at desktop width. Ages are counted from now,
// when the list was read.
export function AskList({ asks, now }: { asks: PageAsk[]; now: number }) {
  const [first, ...rest] = longestWaitingFirst(asks);
  if (first === undefined) return null;
  return (
    <div className={styles.list}>
      <TopCard ask={first} now={now} />
      {rest.length > 0 && <MoreAsks asks={rest} now={now} />}
    </div>
  );
}
