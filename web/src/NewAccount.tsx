import { useId } from "react";
import styles from "./NewAccount.module.css";
import { SampleAsks } from "./SampleAsks";

// Shown when the account has never had an ask. It starts with example
// rules, so sample asks sent from here are sorted with no agent connected,
// and show in the list in place of this card.
export function NewAccount() {
  const heading = useId();
  return (
    <main className={styles.card} aria-labelledby={heading}>
      <h1 className={styles.title} id={heading}>
        Your agents can ask here.
      </h1>
      <p className={styles.about}>
        When an agent stops to wait for you, its ask appears on this page. It
        starts with example rules, which are yours to change. Connect an agent,
        or send sample asks to watch the rules sort them.
      </p>
      <div className={styles.actions}>
        <a className={styles.connect} href="#connect">
          Connect your agents
        </a>
        <SampleAsks />
      </div>
    </main>
  );
}
