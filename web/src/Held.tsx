import { useId, type ReactNode, type Ref } from "react";
import styles from "./Held.module.css";

// What holds the asks back: a hashtag's hours, or the time each ask lapsed.
export type HeldBy = "hours" | "lapse";

// The words of each line, by how many asks it holds, and once they are
// shown, by how many are showing.
const words: Record<
  HeldBy,
  { held: (count: number) => string; showing: (count: number) => string }
> = {
  hours: {
    held: (count) =>
      `${String(count)} held until ${count === 1 ? "its" : "their"} hours`,
    showing: (count) =>
      `Showing ${String(count)} held ask${count === 1 ? "" : "s"}`,
  },
  lapse: {
    held: (count) => `${String(count)} ${count === 1 ? "has" : "have"} lapsed`,
    showing: (count) =>
      `Showing ${String(count)} lapsed ask${count === 1 ? "" : "s"}`,
  },
};

// A clock for the hours, and an hourglass for the lapse.
const icons: Record<HeldBy, ReactNode> = {
  hours: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  lapse: (
    <>
      <path d="M6 3h12M6 21h12" />
      <path d="M7 3v3l5 6 5-6V3M7 21v-3l5-6 5 6v3" />
    </>
  ),
};

// A line of asks held back (docs/design.md, "The held line" and "The lapsed
// line"): how many asks are held back until their hours, or how many have
// lapsed, and a control to show them, or once shown, how many are showing,
// and a control to hide them again. It sits under the tabs, or at the foot
// of All clear (Asks.tsx). The ref is the control's, and the control is
// described by the line's words, so two lines' controls can be told apart.
export function Held({
  by,
  count,
  showing,
  onToggle,
  ref,
}: {
  by: HeldBy;
  count: number;
  showing: boolean;
  onToggle: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  const said = useId();
  return (
    <div className={styles.held}>
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {icons[by]}
      </svg>
      <span id={said}>
        {showing ? words[by].showing(count) : words[by].held(count)}
      </span>
      <button
        className={styles.toggle}
        ref={ref}
        type="button"
        aria-describedby={said}
        onClick={onToggle}
      >
        {showing ? "Hide them" : "Show them"}
      </button>
    </div>
  );
}
