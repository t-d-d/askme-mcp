import type { Ref } from "react";
import styles from "./AllClear.module.css";

// The second line changes on each visit.
const lines = [
  "Go and put the kettle on.",
  "Go outside for a bit.",
  "Stretch your legs.",
  "Look out of the window.",
  "Finish that cup of tea.",
  "Nothing to see here. Lovely.",
];

const thisVisit = lines[Math.floor(Math.random() * lines.length)];

// Shown when nothing is waiting and the account has had an ask before. The
// page can move focus to the headline, though Tab never stops there. While a
// note shows at the foot of the screen, the headline stays where it is.
export function AllClear({
  noted,
  ref,
}: {
  noted: boolean;
  ref?: Ref<HTMLHeadingElement>;
}) {
  return (
    <main className={styles.allClear} data-noted={noted ? "" : undefined}>
      <h1 className={styles.headline} ref={ref} tabIndex={-1}>
        All clear.
      </h1>
      <p className={styles.fixed}>Your agents are getting on with it.</p>
      <p className={styles.line}>{thisVisit}</p>
    </main>
  );
}
