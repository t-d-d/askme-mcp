import { useId } from "react";
import styles from "./NewAccount.module.css";

// Shown when the account has never had an ask.
export function NewAccount() {
  const heading = useId();
  return (
    <main className={styles.card} aria-labelledby={heading}>
      <h1 className={styles.title} id={heading}>
        Your agents can ask here.
      </h1>
      <p className={styles.about}>
        When an agent stops to wait for you, its ask appears on this page.
        Connect an agent to start.
      </p>
      <div className={styles.actions}>
        <a className={styles.connect} href="#connect">
          Connect your agents
        </a>
      </div>
    </main>
  );
}
