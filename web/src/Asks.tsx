import { useState } from "react";
import { AllClear } from "./AllClear";
import { AskList } from "./AskList";
import { everything, onTab, type Tab } from "./asks";
import styles from "./Asks.module.css";
import { Header } from "./Header";
import { NewAccount } from "./NewAccount";
import { Tabs } from "./Tabs";
import { useAsks } from "./useAsks";

// The main screen: the person's open asks, or when none are waiting, All
// clear, or for an account that has never had an ask, how to begin. The list
// updates on its own while the page is visible.
//
// The tabs show every ask, or one hashtag's. A tab whose hashtag has left
// the rules gives way to Everything. A hashtag's tab with nothing waiting is
// all clear, under the tabs.
export function Asks() {
  const { data, receivedAt, failed } = useAsks();
  const [chosen, choose] = useState<Tab>(everything);
  const hashtags = data?.hashtags ?? [];
  const tab = hashtags.some(({ name }) => name === chosen)
    ? chosen
    : everything;
  const allClear = data?.asks.length === 0 && data.everAsked;
  const shown = data === undefined ? [] : onTab(data.asks, tab);
  return (
    <div className={styles.screen}>
      <Header />
      {!allClear && (
        <Tabs hashtags={hashtags} selected={tab} onSelect={choose} />
      )}
      {failed && (
        <p className={styles.note} role="status">
          Not connected. Trying again.
        </p>
      )}
      {data === undefined ? null : shown.length > 0 ? (
        <main>
          <AskList
            asks={shown}
            hashtags={data.hashtags}
            tab={tab}
            now={receivedAt}
          />
        </main>
      ) : data.everAsked ? (
        <AllClear />
      ) : (
        <NewAccount />
      )}
    </div>
  );
}
