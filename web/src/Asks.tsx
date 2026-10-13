import { useMemo, useRef, useState } from "react";
import type { AskActions } from "./actions";
import { AllClear } from "./AllClear";
import { AskList } from "./AskList";
import { DismissedNote } from "./DismissedNote";
import { listView } from "./listView";
import { everything, type Tab } from "./tab";
import styles from "./Asks.module.css";
import { Header } from "./Header";
import { Held } from "./Held";
import { NewAccount } from "./NewAccount";
import { OpenCard } from "./OpenCard";
import { hashtagColours } from "./palette";
import { layers, useLayer } from "./slide";
import { SortingLine } from "./SortingLine";
import { browserSpeech } from "./speech";
import { Tabs, type TabsHandle } from "./Tabs";
import { useAsks } from "./useAsks";
import type { Dismissing } from "./useDismissing";
import { useFocusRescue } from "./useFocusRescue";
import { useListPlace } from "./useListPlace";
import { useOpening } from "./useOpening";

export function Asks({
  card,
  dismissing,
}: {
  card: string | null;
  dismissing: Dismissing;
}) {
  const { data, receivedAt, polledAt, serviceAhead, receivedAhead, failed } =
    useAsks();
  const [chosen, choose] = useState<Tab>(everything);
  const [showingHeld, showHeld] = useState(false);
  const [showingLapsed, showLapsed] = useState(false);
  const [speak] = useState(browserSpeech);
  const { opened, markOpened } = useOpening();
  const { dismissed, note, dismiss, undo } = dismissing;
  const headline = useRef<HTMLHeadingElement>(null);
  const tabs = useRef<TabsHandle>(null);
  const actions = useMemo<AskActions>(
    () => ({ speak, markOpened, dismiss }),
    [speak, markOpened, dismiss],
  );
  const hashtags = data?.hashtags ?? [];
  const {
    open,
    tab,
    shown,
    heldHere,
    lapsedHere,
    allClear,
    sorting,
    coloured,
    keepHeld,
    keepLapsed,
  } = useMemo(
    () =>
      listView({
        answer: data,
        polledAt,
        serviceAhead,
        dismissed,
        opened,
        card,
        chosen,
        showingHeld,
        showingLapsed,
      }),
    [
      data,
      polledAt,
      serviceAhead,
      dismissed,
      opened,
      card,
      chosen,
      showingHeld,
      showingLapsed,
    ],
  );
  if (showingHeld && !keepHeld) showHeld(false);
  if (showingLapsed && !keepLapsed) showLapsed(false);
  if (tab !== chosen) choose(tab);
  useLayer(open === undefined ? layers.list : layers.card);
  const list = useListPlace(
    open?.id,
    shown.map(({ id }) => id),
    headline,
  );
  const anyHeld = heldHere > 0 || lapsedHere > 0;
  const noted = note !== null;
  // Lost focus moves to All clear, or to the selected tab while there are
  // tabs, so a screen reader says what happened. A tab whose hashtag goes
  // leaves Everything selected.
  useFocusRescue(list, () => {
    if (allClear) headline.current?.focus();
    else tabs.current?.focusSelected();
  });
  const allClearHere = <AllClear noted={noted} ref={headline} />;
  const notConnected = failed && (
    <p className={styles.note} role="status">
      Not connected. Trying again.
    </p>
  );

  // The note stays in one place in the tree, whichever screen shows, so a
  // screen reader hears a note that comes as the card closes.
  return (
    <>
      {open !== undefined ? (
        <OpenCard
          ask={open}
          tab={tab}
          now={receivedAt}
          serviceAhead={receivedAhead}
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
          {allClear && notConnected}
          {allClear && allClearHere}
          {/* The lines stay in this one place whether or not there are tabs,
              so their controls keep focus as the list goes all clear. */}
          <div
            className={styles.bar}
            data-all-clear={allClear ? "" : undefined}
          >
            {!allClear && (
              <Tabs
                hashtags={hashtags}
                selected={tab}
                onSelect={choose}
                ref={tabs}
              />
            )}
            {anyHeld && (
              <div className={styles.lines}>
                {heldHere > 0 && (
                  <Held
                    by="hours"
                    count={heldHere}
                    showing={showingHeld}
                    onToggle={() => {
                      showHeld(!showingHeld);
                    }}
                  />
                )}
                {lapsedHere > 0 && (
                  <Held
                    by="lapse"
                    count={lapsedHere}
                    showing={showingLapsed}
                    onToggle={() => {
                      showLapsed(!showingLapsed);
                    }}
                  />
                )}
              </div>
            )}
            {sorting !== null && <SortingLine words={sorting} />}
          </div>
          {!allClear && notConnected}
          {data === undefined || allClear ? null : shown.length > 0 ? (
            <main>
              <AskList
                asks={shown}
                hashtags={coloured}
                tab={tab}
                now={receivedAt}
                serviceAhead={receivedAhead}
                actions={actions}
              />
            </main>
          ) : data.everAsked ? (
            allClearHere
          ) : (
            <NewAccount />
          )}
        </div>
      )}
      <DismissedNote note={note} onUndo={undo} />
    </>
  );
}
