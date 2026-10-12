import { useCallback, useRef } from "react";
import type { Hashtag } from "../../shared/page-api";
import { everything, type Tab } from "./tab";
import { colourOf, tagColour } from "./palette";
import styles from "./Tabs.module.css";

// Everything first, then one tab per hashtag, in the order the rules give
// them. With no hashtags there is only Everything.
//
// A hashtag's tab goes when its hashtag leaves the rules. If it has focus
// then, focus moves to Everything, the tab the page selects in its place,
// rather than falling back to the top of the page. The ref callback stays
// the same between renders, so React calls its cleanup only as the tab goes,
// while the tab still has focus.
export function Tabs({
  hashtags,
  selected,
  onSelect,
}: {
  hashtags: readonly Hashtag[];
  selected: Tab;
  onSelect: (tab: Tab) => void;
}) {
  const everythingTab = useRef<HTMLButtonElement>(null);
  const keepFocus = useCallback(
    (control: HTMLButtonElement) => () => {
      if (control === document.activeElement) everythingTab.current?.focus();
    },
    [],
  );
  return (
    <nav className={styles.tabs} aria-label="Hashtags">
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
