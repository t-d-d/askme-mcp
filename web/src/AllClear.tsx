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

// Shown when nothing is waiting and the account has had an ask before.
export function AllClear() {
  return (
    <main className={styles.allClear}>
      <h1 className={styles.headline}>All clear.</h1>
      <p className={styles.fixed}>Your agents are getting on with it.</p>
      <p className={styles.line}>{thisVisit}</p>
    </main>
  );
}
