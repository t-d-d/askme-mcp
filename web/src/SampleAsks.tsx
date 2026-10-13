import { refusalNote } from "./refusalNote";
import styles from "./SampleAsks.module.css";
import { useAfter } from "./useAfter";
import { useSamples } from "./useSamples";

// "Send sample asks", for someone with no agent yet, and under it one short
// note when a press does not go through: which limit it reached and when to
// try again, in the page's own words (docs/design.md, "Words"). The button
// waits while a press is under way, so one press sends once. The note's
// region stays on the page, empty and hidden, so a screen reader hears
// each note as it comes. The daily cap's note goes once the cap resets,
// with no reload, by the service's clock, which counts the cap.
//
// The button is a main button on the list, and a settings screen's on
// Connect your agents.
export function SampleAsks({
  settings = false,
  onSent,
}: {
  settings?: boolean;
  onSent?: () => void;
}) {
  const send = useSamples(onSent);
  const note =
    send.error === null ? null : refusalNote(send.error, send.submittedAt);
  useAfter(note?.goesAt, send.reset);
  return (
    <div className={styles.samples}>
      <button
        className={settings ? styles.settings : styles.send}
        type="button"
        disabled={send.isPending}
        onClick={() => {
          send.mutate();
        }}
      >
        Send sample asks
      </button>
      <p className={styles.note} role="status">
        {note !== null &&
          (note.kind === "failed" ? `${note.words} Try again.` : note.words)}
      </p>
    </div>
  );
}
