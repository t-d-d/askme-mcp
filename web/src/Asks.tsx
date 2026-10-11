import { asksAnswer, pagePaths } from "../../shared/page-api";
import { AllClear } from "./AllClear";
import { AskList } from "./AskList";
import styles from "./Asks.module.css";
import { Header } from "./Header";
import { NewAccount } from "./NewAccount";
import { Tabs } from "./Tabs";
import { useAnswer } from "./useAnswer";

// The main screen: the person's open asks, or when none are waiting, All
// clear, or for an account that has never had an ask, how to begin.
export function Asks() {
  const { data, receivedAt, failed } = useAnswer(pagePaths.asks, asksAnswer);
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
