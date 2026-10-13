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
      <HashtagPills
        hashtags={sort.hashtags}
        colours={colours}
        className={styles.pill}
      />
    </span>
  );
}

// One pill per hashtag, each in its own colour. The caller lays them out.
export function HashtagPills({
  hashtags,
  colours,
  className,
}: {
  hashtags: readonly string[];
  colours: ReadonlyMap<string, HashtagColour>;
  className: string | undefined;
}) {
  return hashtags.map((name) => (
    <span
      className={className}
      key={name}
      style={tagColour(colours.get(name) ?? neutral)}
    >
      #{name}
    </span>
  ));
}
