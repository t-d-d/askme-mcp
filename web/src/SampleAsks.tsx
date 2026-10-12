import { Refusal } from "./load";
import styles from "./SampleAsks.module.css";
import { useSamples } from "./useSamples";

// "Send sample asks", for someone with no agent yet, and under it one short
// note when a press does not go through: which limit it reached and when to
// try again, in the page's own words (docs/design.md, "Words"). The button
// waits while a press is under way, so one press sends once. The note's
// region stays on the page, empty and hidden, so a screen reader hears
// each note as it comes.
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
        {send.error !== null && <Note error={send.error} />}
      </p>
    </div>
  );
}

function Note({ error }: { error: Error }) {
  if (error instanceof Refusal && error.code === "cap_reached") {
    return <>You&apos;ve reached today&apos;s limit. It resets tomorrow.</>;
  }
  if (error instanceof Refusal && error.code === "rate_limited") {
    return <>Slow down a little. Try again in a few seconds.</>;
  }
  return <>That didn&apos;t go through. Try again.</>;
}
