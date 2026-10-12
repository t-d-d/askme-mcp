import type { PageAsk } from "../../shared/page-api";
import { neutral, tagColour, type HashtagColour } from "./palette";
import styles from "./Pills.module.css";

// An ask's hashtags, each in its own colour, in the rules' order, or "Not
// sorted yet" in the colour of the card it is on.
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
