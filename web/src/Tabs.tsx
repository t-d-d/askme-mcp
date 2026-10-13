import { useCallback, useImperativeHandle, useRef, type Ref } from "react";
import type { Hashtag } from "../../shared/page-api";
import { everything, type Tab } from "./tab";
import { colourOf, tagColour } from "./palette";
import styles from "./Tabs.module.css";

export interface TabsHandle {
  focusSelected: () => void;
}

export function Tabs({
  hashtags,
  selected,
  onSelect,
  onGoneWithFocus,
  onBackWithFocus,
  ref,
}: {
  hashtags: readonly Hashtag[];
  selected: Tab;
  onSelect: (tab: Tab) => void;
  onGoneWithFocus: () => void;
  onBackWithFocus: () => void;
  ref?: Ref<TabsHandle>;
}) {
  const nav = useRef<HTMLElement>(null);
  useImperativeHandle(
    ref,
    () => ({
      focusSelected: () => {
        nav.current
          ?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
          ?.focus();
      },
    }),
    [],
  );
  const everythingTab = useRef<HTMLButtonElement>(null);
  // Stable, so React runs a tab's cleanup only as it goes, while it still
  // has focus. Focus then moves to Everything, not the top of the page.
  const keepFocus = useCallback(
    (control: HTMLButtonElement) => () => {
      if (control === document.activeElement) everythingTab.current?.focus();
    },
    [],
  );
  // onGoneWithFocus and onBackWithFocus must be stable, or this reruns every
  // render. StrictMode detaches and reattaches the ref of new tabs after the
  // page may have moved focus into them, so onBackWithFocus says no tab went.
  const handOn = useCallback(
    (tabs: HTMLElement) => {
      nav.current = tabs;
      if (tabs.contains(document.activeElement)) onBackWithFocus();
      return () => {
        if (tabs.contains(document.activeElement)) onGoneWithFocus();
      };
    },
    [onGoneWithFocus, onBackWithFocus],
  );
  return (
    <nav className={styles.tabs} ref={handOn} aria-label="Hashtags">
      <button
        className={styles.tab}
        ref={everythingTab}
        type="button"
        aria-pressed={selected === everything}
        onClick={() => {
          onSelect(everything);
        }}
      >
        <span className={styles.everything}>Everything</span>
      </button>
      {hashtags.map(({ name, colour }) => (
        <button
          className={styles.tab}
          key={name}
          ref={keepFocus}
          type="button"
          aria-pressed={selected === name}
          style={tagColour(colourOf(colour))}
          onClick={() => {
            onSelect(name);
          }}
        >
          <span className={styles.hashtag}>#{name}</span>
        </button>
      ))}
    </nav>
  );
}
