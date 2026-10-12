import { useId } from "react";
import type { PageAsk } from "../../shared/page-api";
import { age } from "./asks";
import styles from "./MoreAsks.module.css";
import {
  sortedColour,
  tagColour,
  unsorted,
  type HashtagColour,
} from "./palette";

// Every ask after the first, as compact rows under a count. Each row shows
// its first hashtag, in that hashtag's colour.
export function MoreAsks({
  asks,
  now,
  colours,
}: {
  asks: PageAsk[];
  now: number;
  colours: ReadonlyMap<string, HashtagColour>;
}) {
  const heading = useId();
  return (
    <section className={styles.more} aria-labelledby={heading}>
      <h2 className={styles.count} id={heading}>
        {asks.length} more waiting
      </h2>
      <ol className={styles.rows}>
        {asks.map(({ id, summary, postedAt, sort }) => {
          const first = sort?.hashtags[0];
          return (
            <li
              className={styles.row}
              key={id}
              style={tagColour(
                sort === null ? unsorted : sortedColour(sort, colours),
              )}
            >
              <span className={styles.summary}>{summary}</span>
              <span className={styles.meta}>
                {sort === null ? (
                  <span className={styles.pill}>Not sorted yet</span>
                ) : (
                  first !== undefined && (
                    <span className={styles.pill}>#{first}</span>
                  )
                )}
                <span>{age(postedAt, now)}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
