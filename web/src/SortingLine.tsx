import { Fragment } from "react";
import styles from "./SortingLine.module.css";

// The sorting line (docs/design.md, "The sorting line"): how many asks are
// being sorted with the rules, or how many couldn't be sorted. It looks
// like the held line, with no clock and no control, and sits under the
// tabs, below the held line when both show. Each sentence keeps to one
// line, so on a phone the words break between them.
export function SortingLine({ words }: { words: string }) {
  const sentences = words.split(/(?<=\.) /u);
  return (
    <p className={styles.line}>
      <span>
        {sentences.map((sentence, place) => (
          <Fragment key={sentence}>
            {place > 0 && " "}
            <span className={styles.sentence}>{sentence}</span>
          </Fragment>
        ))}
      </span>
    </p>
  );
}
