import type { PageAsk } from "../../shared/page-api";
import {
  neutral,
  sortedColour,
  tagColour,
  unsorted,
  type HashtagColour,
} from "./palette";
import styles from "./TopCard.module.css";
import { waiting } from "./waiting";

// The first ask in the list, given most of the screen: its hashtags, how
// long it has waited and its summary in large type. At desktop width its
// spoken text sits beside it. The card takes its first hashtag's colour.
export function TopCard({
  ask,
  now,
  colours,
}: {
  ask: PageAsk;
  now: number;
  colours: ReadonlyMap<string, HashtagColour>;
}) {
  const { sort } = ask;
  return (
    <article
      className={styles.card}
      style={tagColour(sort === null ? unsorted : sortedColour(sort, colours))}
    >
      <div className={styles.meta}>
        {sort === null ? (
          <span className={styles.pill}>Not sorted yet</span>
        ) : (
          <span className={styles.pills}>
            {sort.hashtags.map((name) => (
              <span
                className={styles.pill}
                key={name}
                style={tagColour(colours.get(name) ?? neutral)}
              >
                #{name}
              </span>
            ))}
          </span>
        )}
        <span className={styles.age}>{waiting(ask.postedAt, now)}</span>
      </div>
      <p className={styles.summary}>{ask.summary}</p>
      <p className={styles.spoken}>{ask.spokenDetail}</p>
    </article>
  );
}
