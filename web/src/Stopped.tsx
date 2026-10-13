import styles from "./Stopped.module.css";

// Shown in place of a screen when the page cannot go on, in the words of
// the "Not connected" note, with the one thing that may fix it.
export function Stopped({ words }: { words: string }) {
  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <span className={styles.wordmark}>askme</span>
      </header>
      <main className={styles.main}>
        <p className={styles.note} role="alert">
          {words}
        </p>
        <button
          className={styles.reload}
          type="button"
          onClick={() => {
            window.location.reload();
          }}
        >
          Reload the page
        </button>
      </main>
    </div>
  );
}
