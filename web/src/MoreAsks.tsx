import { useId } from "react";
import type { PageAsk } from "../../shared/page-api";
import { age, shownUnder, type Tab } from "./asks";
import styles from "./MoreAsks.module.css";
import { askColour, tagColour, type HashtagColour } from "./palette";

// Every ask after the first, as compact rows under a count. Each row shows
// the hashtag it is shown under, in that hashtag's colour: its first on
// Everything, and the tab's on a hashtag's tab.
export function MoreAsks({
  asks,
  tab,
  now,
  colours,
}: {
  asks: PageAsk[];
  tab: Tab;
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
          const shown = sort === null ? undefined : shownUnder(sort, tab);
          return (
            <li
              className={styles.row}
              key={id}
              style={tagColour(askColour(sort, tab, colours))}
            >
              <span className={styles.summary}>{summary}</span>
              <span className={styles.meta}>
                {sort === null ? (
                  <span className={styles.pill}>Not sorted yet</span>
                ) : (
                  shown !== undefined && (
                    <span className={styles.pill}>#{shown}</span>
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
