import styles from "./DismissedNote.module.css";
import type { DismissNote } from "./dismissing";

// The region stays on the page, empty and hidden, so a screen reader hears
// each note as it comes.
export function DismissedNote({
  note,
  onUndo,
}: {
  note: DismissNote | null;
  onUndo: () => void;
}) {
  return (
    <div className={styles.note} role="status">
      {note === "dismissed" && (
        <>
          <span>Dismissed.</span>
          <button className={styles.undo} type="button" onClick={onUndo}>
            Undo
          </button>
        </>
      )}
      {note === "failed" && (
        <span>That didn&apos;t go through. The ask is back.</span>
      )}
    </div>
  );
}
