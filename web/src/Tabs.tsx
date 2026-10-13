import { useImperativeHandle, useRef, type Ref } from "react";
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
  ref,
}: {
  hashtags: readonly Hashtag[];
  selected: Tab;
  onSelect: (tab: Tab) => void;
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
  return (
    <nav className={styles.tabs} ref={nav} aria-label="Hashtags">
      <button
        className={styles.tab}
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
