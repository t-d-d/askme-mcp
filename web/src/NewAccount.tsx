import { useId } from "react";
import styles from "./NewAccount.module.css";
import { SampleAsks } from "./SampleAsks";

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
