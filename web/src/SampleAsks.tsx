import { refusalNote } from "./refusalNote";
import styles from "./SampleAsks.module.css";
import { useAfter } from "./useAfter";
import { useSamples } from "./useSamples";

// The note's region stays on the page, empty and hidden, so a screen reader
// hears each note as it comes.
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
