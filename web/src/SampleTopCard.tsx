import { palette, tagColour } from "./palette";
import styles from "./SampleTopCard.module.css";

// A picture of a top card for the signed-out page. As in the mockup it is
// drawn smaller than a real one, and screen readers skip it.
export function SampleTopCard() {
  return (
    <div
      className={styles.card}
      style={tagColour(palette.orange)}
      aria-hidden="true"
    >
      <div className={styles.meta}>
        <span className={styles.pill}>#shop</span>
        <span className={styles.age}>Waiting 4 min</span>
      </div>
      <p className={styles.summary}>
        Merge the fix for checkout rounding? Tests pass.
      </p>
      <div className={styles.buttons}>
        <div className={styles.main}>
          <span className={styles.label}>See pull request</span>
          <span className={styles.site}>github.com</span>
        </div>
        <div className={styles.listen}>
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M11 5 6 9H3v6h3l5 4V5z" />
            <path d="M15.5 8.5a5 5 0 0 1 0 7" />
            <path d="M18.5 5.5a9 9 0 0 1 0 13" />
          </svg>
        </div>
      </div>
    </div>
  );
}
