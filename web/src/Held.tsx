import styles from "./Held.module.css";

// The held line (docs/design.md, "The held line"): how many asks are held
// back until their hours, and a control to show them, or once shown, how
// many are showing, and a control to hide them again. It sits under the
// tabs, or at the foot of All clear.
export function Held({
  count,
  showing,
  onToggle,
  atFoot = false,
}: {
  count: number;
  showing: boolean;
  onToggle: () => void;
  atFoot?: boolean;
}) {
  const words = showing
    ? `Showing ${String(count)} held ask${count === 1 ? "" : "s"}`
    : `${String(count)} held until ${count === 1 ? "its" : "their"} hours`;
  return (
    <div className={atFoot ? styles.foot : styles.held}>
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
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      <span>{words}</span>
      <button className={styles.toggle} type="button" onClick={onToggle}>
        {showing ? "Hide them" : "Show them"}
      </button>
    </div>
  );
}
