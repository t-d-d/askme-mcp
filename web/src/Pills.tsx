import type { PageAsk } from "../../shared/page-api";
import { neutral, tagColour, type HashtagColour } from "./palette";
import styles from "./Pills.module.css";

// "Not sorted yet" sets no colour, so it takes the colour of its card.
export function Pills({
  sort,
  colours,
}: {
  sort: PageAsk["sort"];
  colours: ReadonlyMap<string, HashtagColour>;
}) {
  if (sort === null) {
    return <span className={styles.pill}>Not sorted yet</span>;
  }
  return (
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
  );
}
