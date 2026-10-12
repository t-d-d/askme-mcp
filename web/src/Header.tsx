import styles from "./Header.module.css";

// The wordmark, and at the right the way to the rules. At desktop width the
// rules and Connect agents are two text links.
export function Header() {
  return (
    <header className={styles.header}>
      <span className={styles.wordmark}>askme</span>
      <nav className={styles.nav} aria-label="Settings">
        <a className={styles.icon} href="#rules" aria-label="Rules">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 7h8M18 7h2M4 17h2M12 17h8" />
            <circle cx="15" cy="7" r="2.5" />
            <circle cx="9" cy="17" r="2.5" />
          </svg>
        </a>
        <a className={styles.link} href="#rules">
          Rules
        </a>
        <a className={styles.link} href="#connect">
          Connect agents
        </a>
      </nav>
    </header>
  );
}
