import type { PageAsk } from "../../shared/page-api";
import { waiting } from "./asks";
import { tagColour, unsorted } from "./palette";
import styles from "./TopCard.module.css";

// The first ask in the list, given most of the screen: how long it has
// waited and its summary in large type. At desktop width its spoken text
// sits beside it.
export function TopCard({ ask, now }: { ask: PageAsk; now: number }) {
  return (
    <article className={styles.card} style={tagColour(unsorted)}>
      <div className={styles.meta}>
        <span className={styles.pill}>Not sorted yet</span>
        <span className={styles.age}>{waiting(ask.postedAt, now)}</span>
      </div>
      <p className={styles.summary}>{ask.summary}</p>
      <p className={styles.spoken}>{ask.spokenDetail}</p>
    </article>
  );
}
