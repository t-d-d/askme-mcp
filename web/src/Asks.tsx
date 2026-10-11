import { AllClear } from "./AllClear";
import { AskList } from "./AskList";
import styles from "./Asks.module.css";
import { Header } from "./Header";
import { NewAccount } from "./NewAccount";
import { Tabs } from "./Tabs";
import { useAsks } from "./useAsks";

// The main screen: the person's open asks, or when none are waiting, All
// clear, or for an account that has never had an ask, how to begin. The list
// updates on its own while the page is visible.
export function Asks() {
  const { data, receivedAt, failed } = useAsks();
  const allClear = data?.asks.length === 0 && data.everAsked;
  return (
    <div className={styles.screen}>
      <Header />
      {!allClear && <Tabs />}
      {failed && (
        <p className={styles.note} role="status">
          Not connected. Trying again.
        </p>
      )}
      {data === undefined ? null : data.asks.length > 0 ? (
        <main>
          <AskList asks={data.asks} now={receivedAt} />
        </main>
      ) : data.everAsked ? (
        <AllClear />
      ) : (
        <NewAccount />
      )}
    </div>
  );
}
