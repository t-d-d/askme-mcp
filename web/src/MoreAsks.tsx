import { useId } from "react";
import type { PageAsk } from "../../shared/page-api";
import { age } from "./asks";
import styles from "./MoreAsks.module.css";
import { tagColour, unsorted } from "./palette";

// Every ask after the first, as compact rows under a count.
export function MoreAsks({ asks, now }: { asks: PageAsk[]; now: number }) {
  const heading = useId();
  return (
    <section className={styles.more} aria-labelledby={heading}>
      <h2 className={styles.count} id={heading}>
        {asks.length} more waiting
      </h2>
      <ol className={styles.rows}>
        {asks.map((ask) => (
          <li className={styles.row} key={ask.id} style={tagColour(unsorted)}>
            <span className={styles.summary}>{ask.summary}</span>
            <span className={styles.meta}>
              <span className={styles.pill}>Not sorted yet</span>
              <span>{age(ask.postedAt, now)}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
