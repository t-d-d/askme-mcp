import type { PageAsk } from "../../shared/page-api";
import { askColour, neutral, tagColour, type HashtagColour } from "./palette";
import type { Tab } from "./tab";
import styles from "./TopCard.module.css";
import { waiting } from "./waiting";

// The first ask in the list, given most of the screen: its hashtags, how
// long it has waited and its summary in large type. At desktop width its
// spoken text sits beside it. The card takes its first hashtag's colour on
// Everything, and the tab's on a hashtag's tab. Each pill keeps its own.
export function TopCard({
  ask,
  tab,
  now,
  colours,
}: {
  ask: PageAsk;
  tab: Tab;
  now: number;
  colours: ReadonlyMap<string, HashtagColour>;
}) {
  const { sort } = ask;
  return (
    <article
      className={styles.card}
      style={tagColour(askColour(sort, tab, colours))}
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
