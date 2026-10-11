import styles from "./Header.module.css";

// The wordmark, the Demo tag, and at the right the way to connect agents.
export function Header() {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <span className={styles.wordmark}>askme</span>
        <span className={styles.demo}>Demo</span>
      </div>
      <nav aria-label="Settings">
        <a className={styles.link} href="#connect">
          Connect agents
        </a>
      </nav>
    </header>
  );
}
