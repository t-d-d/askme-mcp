import { useId, useState, type ReactNode, type SubmitEvent } from "react";
import { rulesLimit } from "../../shared/page-api";
import { useAuth } from "./auth";
import { hoursText } from "./hours";
import { colourOf, tagColour } from "./palette";
import { refusalNote } from "./refusalNote";
import styles from "./Rules.module.css";
import { rulesState, type NoteKind } from "./rulesState";
import type { AskFirst } from "./screen";
import { layers, useLayer } from "./slide";
import { followToList } from "./toList";
import { useAfter } from "./useAfter";
import { useAsks } from "./useAsks";
import { useLeaveGuard } from "./useLeaveGuard";
import { browserTimeZone, useRules } from "./useRules";

const leaving = "Leave without saving your rules?";

// The rules: one box in plain English, and below it the hashtags askme read
// from them, each with its hours. Saving waits while askme reads them. If
// it cannot, the text is saved all the same, the old hashtags and hours
// stay, and the page offers to try again. Either way, saving changed rules
// re-sorts every open ask, and a last note says so, after the time zone the
// hours use. At the foot, the address of the account signed in, and Sign
// out.
//
// While some asks couldn't be sorted, "Save rules" works on unchanged text
// too, unless today's sorting limit is reached. When the last reading
// succeeded, that save reads nothing, and sorts again only the asks still
// behind the rules (ADR 22). The screen polls the list, as the list does,
// to know when asks stopped and when the limit is reached. A save refused
// at the limit keeps the text in the box, and says when the limit resets.
// That note goes once the limit resets, with no reload. The service's clock
// decides when asks stop and when the limit resets, for the note and the
// button alike.
export function Rules({ askFirst }: { askFirst: AskFirst }) {
  useLayer(layers.rules);
  const auth = useAuth();
  const { loaded, save } = useRules();
  const { data } = loaded;
  const listed = useAsks();
  const boxId = useId();
  const readId = useId();
  // What the person has typed since the rules last loaded or saved.
  const [draft, setDraft] = useState<string | null>(null);
  // Whether the last save sent the text unchanged, after a reading that
  // succeeded, so askme sorts the asks again and reads nothing.
  const [resorting, setResorting] = useState(false);
  const refused =
    save.error === null ? null : refusalNote(save.error, save.submittedAt);
  // Once the limit resets, the refusal's note goes. The refused save sorted
  // nothing, so no note says the asks are being sorted again either.
  useAfter(refused?.goesAt, () => {
    setResorting(false);
    save.reset();
  });
  const { text, changed, ready, note } = rulesState({
    loaded,
    listed,
    draft,
    resorting,
    save: {
      pending: save.isPending,
      succeeded: save.isSuccess,
      submittedAt: save.submittedAt,
      refused,
    },
  });
  const { away, mayLeave } = useLeaveGuard(changed, askFirst, leaving);

  // Signing out leaves the rules too, so unsaved text asks first. The screen
  // goes from the address, so whoever signs in next starts at the list.
  const signOut = () => {
    if (!mayLeave()) return;
    const { pathname, search } = window.location;
    window.history.replaceState(null, "", pathname + search);
    auth.signOut();
  };

  const saveText = () => {
    const sent = text;
    setResorting(!changed && data?.readFailed === false);
    save.mutate(sent, {
      // Text typed while the save was under way stays as typed.
      onSuccess: () => {
        setDraft((typed) => (typed === sent ? null : typed));
      },
    });
  };
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (ready) saveText();
  };

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <a
          className={styles.back}
          href="#asks"
          onClick={(event) => {
            away(event);
            followToList(event);
          }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
          All asks
        </a>
        <a className={styles.link} href="#connect" onClick={away}>
          Connect agents
        </a>
      </header>
      <main className={styles.main}>
        <form className={styles.form} onSubmit={submit}>
          <h1 className={styles.title}>Your rules</h1>
          <label className={styles.label} htmlFor={boxId}>
            Write them in plain English. Name your hashtags, say what comes
            first, and give any hours a hashtag should keep to.
          </label>
          <textarea
            className={styles.box}
            id={boxId}
            rows={12}
            maxLength={rulesLimit}
            value={text}
            disabled={data === undefined}
            onChange={(event) => {
              setDraft(event.target.value);
              setResorting(false);
              // A failed save's note goes once the text changes.
              if (save.isError) save.reset();
            }}
          />
          <button
            className={ready ? styles.save : styles.saved}
            type="submit"
            disabled={!ready || save.isPending}
          >
            Save rules
          </button>
          <Note note={note} onRetry={saveText} />
        </form>
        <section className={styles.read} aria-labelledby={readId}>
          <h2 className={styles.heading} id={readId}>
            askme read this from your rules
          </h2>
          {data !== undefined &&
            (data.hashtags.length === 0 ? (
              <p className={styles.none}>
                No hashtags yet. Write one with # in front, such as #work.
              </p>
            ) : (
              <ul className={styles.hashtags}>
                {data.hashtags.map(({ name, colour, hours }) => (
                  <li className={styles.hashtag} key={name}>
                    <span
                      className={styles.pill}
                      style={tagColour(colourOf(colour))}
                    >
                      #{name}
                    </span>
                    <span className={styles.hours}>
                      {hoursText(hours ?? []).map((line, place) => (
                        <span className={styles.window} key={place}>
                          {line}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            ))}
          <Footnote loaded={data !== undefined} saved={data?.timeZone} />
        </section>
        <div className={styles.account}>
          {auth.email !== null && (
            <p className={styles.signedIn}>{auth.email}</p>
          )}
          <button className={styles.signOut} type="button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </main>
    </div>
  );
}

// The last note: the time zone the hours use, once the rules have loaded,
// and what saving sorts again. A save takes this browser's time zone, so
// when another browser saved the rules, the note says which one saving
// here uses.
function Footnote({
  loaded,
  saved,
}: {
  loaded: boolean;
  saved: string | undefined;
}) {
  const here = browserTimeZone();
  const zone =
    saved === undefined || saved === here
      ? `Hours use ${here}, taken from this browser. `
      : `Hours use ${saved}, taken from the browser that saved them. Saving here uses ${here}. `;
  return (
    <p className={styles.footnote}>
      {loaded && zone}Saving changed rules re-sorts every open ask, and saving
      them unchanged sorts again any that couldn&apos;t be sorted.
    </p>
  );
}

// One short note under the button, giving the state.
function Note({ note, onRetry }: { note: NoteKind; onRetry: () => void }) {
  if (note.kind === "none") return null;
  const retry = (
    <button className={styles.retry} type="button" onClick={onRetry}>
      Try again
    </button>
  );
  return (
    <p className={styles.note} role="status">
      {noteWords(note, retry)}
    </p>
  );
}

// What a note says, ending with Try again where it offers one.
function noteWords(
  note: Exclude<NoteKind, { kind: "none" }>,
  retry: ReactNode,
): ReactNode {
  switch (note.kind) {
    case "notConnected":
      return "Not connected. Trying again.";
    case "reading":
      return "Reading your rules.";
    case "sorting":
      return "Sorting your asks again.";
    case "refused":
      return (
        <>
          {note.words}
          {note.retry && <> {retry}</>}
        </>
      );
    case "readFailed":
      return (
        <>
          askme couldn&apos;t read your rules just now. Your text is saved.{" "}
          {retry}
        </>
      );
    case "saved":
      return "Saved.";
    case "savedAsleep":
      return "Saved. The button wakes up when you change the text.";
  }
}
