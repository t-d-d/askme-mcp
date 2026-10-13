import { Fragment } from "react";
import styles from "./SortingLine.module.css";

// Each sentence keeps to one line, so on a phone the line breaks between
// sentences.
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
