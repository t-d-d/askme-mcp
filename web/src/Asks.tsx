import { useState } from "react";
import type { PageAsk } from "../../shared/page-api";
import { AllClear } from "./AllClear";
import { AskList } from "./AskList";
import { everything, onTab, type Tab } from "./tab";
import styles from "./Asks.module.css";
import { Header } from "./Header";
import { Held } from "./Held";
import { heldAsks } from "./hours";
import { NewAccount } from "./NewAccount";
import { Tabs } from "./Tabs";
import { useAsks } from "./useAsks";

// The main screen: the person's open asks, or when none are waiting, All
// clear, or for an account that has never had an ask, how to begin. The list
// updates on its own while the page is visible.
//
// The tabs show every ask, or one hashtag's. A tab whose hashtag has left
// the rules gives way to Everything, and so does any tab when the whole list
// is all clear and the tabs go, so a hashtag that comes back, or the next
// ask, finds the page on Everything. A hashtag's tab with nothing waiting is
// all clear, under the tabs.
//
// An ask with a hashtag outside its hours is held back, on every tab, as of
// when the list was last read. The held line under the tabs counts the
// tab's held asks and shows them, or hides them again. With every ask held
// and hidden the list is all clear, and the line sits at its foot. Once
// nothing is held, held asks are hidden again when they are next held.
export function Asks() {
  const { data, receivedAt, failed } = useAsks();
  const [chosen, choose] = useState<Tab>(everything);
  const [showingHeld, showHeld] = useState(false);
  const hashtags = data?.hashtags ?? [];
  const asks = data?.asks ?? [];
  const held = heldAsks(asks, hashtags, data?.timeZone, receivedAt);
  if (showingHeld && held.size === 0) showHeld(false);
  const waiting = (list: readonly PageAsk[]) =>
    showingHeld ? list : list.filter(({ id }) => !held.has(id));
  const allClear = data?.everAsked === true && waiting(asks).length === 0;
  const tab =
    !allClear && hashtags.some(({ name }) => name === chosen)
      ? chosen
      : everything;
  if (tab !== chosen) choose(tab);
  const onThisTab = onTab(asks, tab);
  const shown = waiting(onThisTab);
  const heldHere = onThisTab.filter(({ id }) => held.has(id)).length;
  const heldLine = (atFoot: boolean) => (
    <Held
      count={heldHere}
      showing={showingHeld}
      atFoot={atFoot}
      onToggle={() => {
        showHeld(!showingHeld);
      }}
    />
  );
  return (
    <div className={styles.screen}>
      <Header />
      {!allClear && (
        <div className={styles.bar}>
          <Tabs hashtags={hashtags} selected={tab} onSelect={choose} />
          {heldHere > 0 && heldLine(false)}
        </div>
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
        <>
          <AllClear />
          {allClear && heldHere > 0 && heldLine(true)}
        </>
      ) : (
        <NewAccount />
      )}
    </div>
  );
}
