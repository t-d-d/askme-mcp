import styles from "./Tabs.module.css";

// Everything first, then one tab per hashtag. Until the rules give hashtags
// there is only Everything, and it is selected.
export function Tabs() {
  return (
    <nav className={styles.tabs} aria-label="Hashtags">
      <button className={styles.tab} type="button" aria-pressed="true">
        <span className={styles.everything}>Everything</span>
      </button>
    </nav>
  );
}
