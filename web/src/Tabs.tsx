import type { Hashtag } from "../../shared/page-api";
import { everything, type Tab } from "./asks";
import { colourOf, tagColour } from "./palette";
import styles from "./Tabs.module.css";

// Everything first, then one tab per hashtag, in the order the rules give
// them. With no hashtags there is only Everything.
export function Tabs({
  hashtags,
  selected,
  onSelect,
}: {
  hashtags: readonly Hashtag[];
  selected: Tab;
  onSelect: (tab: Tab) => void;
}) {
  return (
    <nav className={styles.tabs} aria-label="Hashtags">
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
