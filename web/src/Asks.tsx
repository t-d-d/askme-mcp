import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PageAsk } from "../../shared/page-api";
import type { AskActions } from "./actions";
import { AllClear } from "./AllClear";
import { AskList } from "./AskList";
import { DismissedNote } from "./DismissedNote";
import { everything, onTab, type Tab } from "./tab";
import styles from "./Asks.module.css";
import { Header } from "./Header";
import { Held } from "./Held";
import { heldAsks } from "./hours";
import { NewAccount } from "./NewAccount";
import { OpenCard } from "./OpenCard";
import { hashtagColours } from "./palette";
import { browserSpeech } from "./speech";
import { Tabs, type TabsHandle } from "./Tabs";
import { useAsks } from "./useAsks";
import { useDismissing } from "./useDismissing";
import { useListPlace } from "./useListPlace";
import { useOpening } from "./useOpening";
import { inListOrder } from "./waiting";

// The main screen: the person's open asks, or when none are waiting, All
// clear, or for an account that has never had an ask, how to begin. The list
// updates on its own while the page is visible. With a card named in the
// address, that ask is open in place of the list.
//
// The tabs show every ask, or one hashtag's. A tab whose hashtag has left
// the rules gives way to Everything, and so does any tab when the whole list
// is all clear and the tabs go, so a hashtag that comes back, or the next
// ask, finds the page on Everything. A hashtag's tab with nothing waiting is
// all clear, under the tabs. If a tab has focus as the tabs go, focus moves
// to the All clear headline, so a screen reader says what happened.
//
// After the rules change, an ask keeps its old hashtags until it is sorted
// again. A hashtag the rules no longer name has no tab, but keeps its
// colour on the asks that still carry it.
//
// An ask with a hashtag outside its hours is held back, on every tab, as of
// the last poll. The held line under the tabs counts the tab's held asks
// and shows them, or hides them again. With every ask held and hidden the
// list is all clear, and the line sits at its foot. If its control has focus
// as the line moves, the control in its new place takes it. If the line goes
// with none in its place, the selected tab takes focus, or with no tabs, as
// the list is all clear, the All clear headline. Once nothing is held, held
// asks are hidden again when they are next held. A held ask dismissed here
// is still held until askme drops it, so Undo brings it back shown. A former
// hashtag has no hours, so it holds nothing back.
//
// An ask the person has opened shows as opened, and one they have dismissed
// leaves the list, before the next poll says so.
//
// Closing a card puts the list back where it was, with focus on the link
// that opened the card, or on the All clear headline when nothing is left
// on the tab (useListPlace.ts).
export function Asks({ card }: { card: string | null }) {
  const { data, receivedAt, polledAt, failed } = useAsks();
  const [chosen, choose] = useState<Tab>(everything);
  const [showingHeld, showHeld] = useState(false);
  const [speak] = useState(browserSpeech);
  const { opened, markOpened } = useOpening();
  const { dismissed, note, dismiss, undo } = useDismissing();
  // The held line is drawn anew as it moves, so its control goes and another
  // comes in the same render. The ref callback stays the same between
  // renders, so React calls its cleanup only as a control goes, while it
  // still has focus, and calls it again only as one comes. The control that
  // takes focus clears the flag, so StrictMode in development, which runs the
  // cleanup and the call a second time, leaves the flag clear.
  const heldHadFocus = useRef(false);
  const keepHeldFocus = useCallback((control: HTMLButtonElement) => {
    if (heldHadFocus.current) {
      heldHadFocus.current = false;
      control.focus();
    }
    return () => {
      if (control === document.activeElement) heldHadFocus.current = true;
    };
  }, []);
  const headline = useRef<HTMLHeadingElement>(null);
  const tabsHadFocus = useRef(false);
  const tabs = useRef<TabsHandle>(null);
  const tabsGoneWithFocus = useCallback(() => {
    tabsHadFocus.current = true;
  }, []);
  // Tabs that come back with focus in them clear the flag, so StrictMode in
  // development, which detaches their ref and attaches it again after focus
  // has moved to the selected tab, leaves it clear.
  const tabsBackWithFocus = useCallback(() => {
    tabsHadFocus.current = false;
  }, []);
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
  // Counted over the list as polled, so an ask dismissed here still counts
  // until askme drops it, and Undo brings it back as it was.
  const held = useMemo(
    () =>
      heldAsks(
        data?.asks ?? [],
        data?.hashtags ?? [],
        data?.timeZone,
        polledAt,
      ),
    [data, polledAt],
  );
  if (showingHeld && held.size === 0) showHeld(false);
  const waiting = (list: readonly PageAsk[]) =>
    showingHeld ? list : list.filter(({ id }) => !held.has(id));
  const open = card === null ? undefined : asks.find(({ id }) => id === card);
  // An open card keeps the list's tab, though every ask behind it is held.
  const allClear =
    open === undefined &&
    data?.everAsked === true &&
    waiting(asks).length === 0;
  const tab =
    !allClear && hashtags.some(({ name }) => name === chosen)
      ? chosen
      : everything;
  if (tab !== chosen) choose(tab);
  const onThisTab = onTab(asks, tab);
  const shown = inListOrder(waiting(onThisTab));
  const heldHere = onThisTab.filter(({ id }) => held.has(id)).length;
  const list = useListPlace(
    open?.id,
    shown.map(({ id }) => id),
    headline,
  );
  const heldLine = (atFoot: boolean) => (
    <Held
      count={heldHere}
      showing={showingHeld}
      atFoot={atFoot}
      onToggle={() => {
        showHeld(!showingHeld);
      }}
      ref={keepHeldFocus}
    />
  );
  const noted = note !== null;
  // The tabs also go when a card opens, so this moves focus only onto All
  // clear, and only in the render the tabs went in. A held line's control
  // that goes with no other to take its place hands focus on in the same
  // way, or to the selected tab while there are tabs, and to none that comes
  // later. With a card open there is neither, so focus is left alone.
  useLayoutEffect(() => {
    if (allClear && (tabsHadFocus.current || heldHadFocus.current)) {
      headline.current?.focus();
    } else if (heldHadFocus.current) {
      tabs.current?.focusSelected();
    }
    tabsHadFocus.current = false;
    heldHadFocus.current = false;
  });

  // The note stays in one place in the tree, whichever screen shows, so a
  // screen reader hears a note that comes as the card closes.
  return (
    <>
      {open !== undefined ? (
        <OpenCard
          ask={open}
          tab={tab}
          now={receivedAt}
          colours={hashtagColours(coloured)}
          actions={actions}
          noted={noted}
        />
      ) : (
        <div
          className={styles.screen}
          data-noted={noted ? "" : undefined}
          ref={list}
        >
          <Header />
          {!allClear && (
            <div className={styles.bar}>
              <Tabs
                hashtags={hashtags}
                selected={tab}
                onSelect={choose}
                onGoneWithFocus={tabsGoneWithFocus}
                onBackWithFocus={tabsBackWithFocus}
                ref={tabs}
              />
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
                hashtags={coloured}
                tab={tab}
                now={receivedAt}
                actions={actions}
              />
            </main>
          ) : data.everAsked ? (
            <>
              <AllClear noted={noted} ref={headline} />
              {allClear && heldHere > 0 && heldLine(true)}
            </>
          ) : (
            <NewAccount />
          )}
        </div>
      )}
      <DismissedNote note={note} onUndo={undo} />
    </>
  );
}
