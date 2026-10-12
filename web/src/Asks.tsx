import { useMemo, useState } from "react";
import type { AskActions } from "./actions";
import { AllClear } from "./AllClear";
import { AskList } from "./AskList";
import { DismissedNote } from "./DismissedNote";
import { everything, onTab, type Tab } from "./tab";
import styles from "./Asks.module.css";
import { Header } from "./Header";
import { NewAccount } from "./NewAccount";
import { OpenCard } from "./OpenCard";
import { hashtagColours } from "./palette";
import { browserSpeech } from "./speech";
import { Tabs } from "./Tabs";
import { useAsks } from "./useAsks";
import { useDismissing } from "./useDismissing";
import { useOpening } from "./useOpening";

// The main screen: the person's open asks, or when none are waiting, All
// clear, or for an account that has never had an ask, how to begin. The list
// updates on its own while the page is visible. With a card named in the
// address, that ask is open in place of the list.
//
// The tabs show every ask, or one hashtag's. A tab whose hashtag has left
// the rules gives way to Everything, and so does any tab when the whole list
// is all clear and the tabs go, so a hashtag that comes back, or the next
// ask, finds the page on Everything. A hashtag's tab with nothing waiting is
// all clear, under the tabs.
//
// After the rules change, an ask keeps its old hashtags until it is sorted
// again. A hashtag the rules no longer name has no tab, but keeps its
// colour on the asks that still carry it.
//
// An ask the person has opened shows as opened, and one they have dismissed
// leaves the list, before the next poll says so.
export function Asks({ card }: { card: string | null }) {
  const { data, receivedAt, failed } = useAsks();
  const [chosen, choose] = useState<Tab>(everything);
  const [speak] = useState(browserSpeech);
  const { opened, markOpened } = useOpening();
  const { dismissed, note, dismiss, undo } = useDismissing();
  const actions = useMemo<AskActions>(
    () => ({ speak, markOpened, dismiss }),
    [speak, markOpened, dismiss],
  );
  const asks = useMemo(
    () =>
      (data?.asks ?? [])
        .filter(({ id }) => !dismissed.has(id))
        .map((ask) => (opened.has(ask.id) ? { ...ask, opened: true } : ask)),
    [data, dismissed, opened],
  );
  const hashtags = data?.hashtags ?? [];
  // Every hashtag an ask may carry, the former ones included, for colour.
  const coloured =
    data === undefined ? [] : [...hashtags, ...data.formerHashtags];
  const allClear = data !== undefined && asks.length === 0 && data.everAsked;
  const tab =
    !allClear && hashtags.some(({ name }) => name === chosen)
      ? chosen
      : everything;
  if (tab !== chosen) choose(tab);
  const shown = onTab(asks, tab);
  const notes = <DismissedNote note={note} onUndo={undo} />;

  const open = card === null ? undefined : asks.find(({ id }) => id === card);
  if (open !== undefined) {
    return (
      <>
        <OpenCard
          ask={open}
          tab={tab}
          now={receivedAt}
          colours={hashtagColours(coloured)}
          actions={actions}
        />
        {notes}
      </>
    );
  }

  return (
    <div className={styles.screen} data-noted={note === null ? undefined : ""}>
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
            hashtags={coloured}
            tab={tab}
            now={receivedAt}
            actions={actions}
          />
        </main>
      ) : data.everAsked ? (
        <AllClear />
      ) : (
        <NewAccount />
      )}
      {notes}
    </div>
  );
}
