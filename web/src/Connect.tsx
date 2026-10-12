import { useId, useRef } from "react";
import { connectionAnswer, pagePaths } from "../../shared/page-api";
import styles from "./Connect.module.css";
import { cursorInstallLink } from "./cursor";
import { SampleAsks } from "./SampleAsks";
import { backToList, followToList } from "./toList";
import { useAnswer } from "./useAnswer";

// How to connect an agent: the server address, the steps for Claude, and
// one click for Cursor. There are no keys to copy. Someone with no agent
// yet can send sample asks instead, and is taken to the list to watch
// their rules sort them.
export function Connect() {
  const { data, failed } = useAnswer(pagePaths.connection, connectionAnswer);
  const address = useRef<HTMLInputElement>(null);
  const addressId = useId();
  const claude = useId();
  const cursor = useId();
  const samples = useId();

  const copy = () => {
    address.current?.select();
    if (data !== undefined) {
      navigator.clipboard.writeText(data.mcpUrl).catch(() => undefined);
    }
  };

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <a className={styles.back} href="#asks" onClick={followToList}>
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
            <path d="M15 18l-6-6 6-6" />
          </svg>
          All asks
        </a>
      </header>
      <main className={styles.main}>
        <div className={styles.intro}>
          <h1 className={styles.title}>Connect your agents</h1>
          <p className={styles.note}>
            Any agent that can use an MCP server can post asks here. You approve
            each connection once, by signing in. There are no keys to copy.
          </p>
          {failed && (
            <p className={styles.note} role="status">
              Not connected. Trying again.
            </p>
          )}
          <label className={styles.label} htmlFor={addressId}>
            Server address
          </label>
          <div className={styles.address}>
            <input
              className={styles.field}
              id={addressId}
              ref={address}
              readOnly
              value={data?.mcpUrl ?? ""}
            />
            <button className={styles.copy} type="button" onClick={copy}>
              Copy
            </button>
          </div>
        </div>
        <section className={styles.section} aria-labelledby={claude}>
          <h2 className={styles.heading} id={claude}>
            Claude
          </h2>
          <ol className={styles.steps}>
            <li>In Claude, add a custom connector.</li>
            <li>Paste the server address.</li>
            <li>Approve askme when Claude asks you to sign in.</li>
          </ol>
        </section>
        <section className={styles.section} aria-labelledby={cursor}>
          <h2 className={styles.heading} id={cursor}>
            Cursor
          </h2>
          {data !== undefined && (
            <a className={styles.cursor} href={cursorInstallLink(data.mcpUrl)}>
              Add askme to Cursor
              <span className={styles.site}>cursor.com</span>
            </a>
          )}
        </section>
        <section className={styles.section} aria-labelledby={samples}>
          <h2 className={styles.heading} id={samples}>
            No agent yet?
          </h2>
          <p className={styles.note}>
            Send a few sample asks from three parts of a life, and watch your
            rules sort them.
          </p>
          <SampleAsks settings onSent={backToList} />
        </section>
      </main>
      <footer>
        <p className={styles.notice}>
          Demo. Every ask is deleted after a month, and sign-ups stop at 100
          accounts.
        </p>
      </footer>
    </div>
  );
}
