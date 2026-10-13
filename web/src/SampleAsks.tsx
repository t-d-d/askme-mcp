import { capped, Refusal } from "./load";
import { resetsHere, resetTime } from "./resets";
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
  useAfter(
    capped(send.error)
      ? resetsHere(send.submittedAt, send.error.serviceAhead)
      : undefined,
    send.reset,
  );
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
        {send.error !== null && (
          <Note error={send.error} pressedAt={send.submittedAt} />
        )}
      </p>
    </div>
  );
}

// The daily cap resets at the next midnight UTC after the press, by the
// service's clock, given in this browser's time zone.
function Note({ error, pressedAt }: { error: Error; pressedAt: number }) {
  if (capped(error)) {
    return (
      <>
        You&apos;ve reached today&apos;s limit. It resets at{" "}
        {resetTime(pressedAt + error.serviceAhead)}.
      </>
    );
  }
  if (error instanceof Refusal && error.code === "rate_limited") {
    return <>Slow down a little. Try again in a few seconds.</>;
  }
  return <>That didn&apos;t go through. Try again.</>;
}
