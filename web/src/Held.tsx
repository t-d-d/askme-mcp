import { useId, type ReactNode } from "react";
import styles from "./Held.module.css";

export type HeldBy = "hours" | "lapse";

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

// Both lines' buttons say "Show them", so each is described by its line's
// words to tell them apart.
export function Held({
  by,
  count,
  showing,
  onToggle,
}: {
  by: HeldBy;
  count: number;
  showing: boolean;
  onToggle: () => void;
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
        type="button"
        aria-describedby={said}
        onClick={onToggle}
      >
        {showing ? "Hide them" : "Show them"}
      </button>
    </div>
  );
}
