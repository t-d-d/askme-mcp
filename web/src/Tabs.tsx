import { useCallback, useImperativeHandle, useRef, type Ref } from "react";
import type { Hashtag } from "../../shared/page-api";
import { everything, type Tab } from "./tab";
import { colourOf, tagColour } from "./palette";
import styles from "./Tabs.module.css";

// Everything first, then one tab per hashtag, in the order the rules give
// them. With no hashtags there is only Everything.
//
// A hashtag's tab goes when its hashtag leaves the rules. If it has focus
// then, focus moves to Everything rather than falling back to the top of
// the page. The ref callback stays the same between renders, so React calls
// its cleanup only as the tab goes, while the tab still has focus.
//
// The tabs all go at once when the list goes all clear, Everything with
// them. If one has focus then, onGoneWithFocus is called, so the page can
// put focus somewhere that stays. StrictMode in development detaches the
// ref of tabs that have just come and attaches it again, after the page may
// have moved focus into them. If they have focus then, onBackWithFocus is
// called, so the page knows that no tab went. Both must stay the same
// between renders.
//
// Through the ref, the page can move focus to the selected tab.
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
  const keepFocus = useCallback(
    (control: HTMLButtonElement) => () => {
      if (control === document.activeElement) everythingTab.current?.focus();
    },
    [],
  );
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
