import {
  useEffect,
  useId,
  useState,
  type MouseEvent,
  type SubmitEvent,
} from "react";
import { rulesLimit } from "../../shared/page-api";
import { useAuth } from "./auth";
import { Refusal } from "./load";
import type { AskFirst } from "./SignedIn";
import { hoursText } from "./hours";
import { colourOf, tagColour } from "./palette";
import styles from "./Rules.module.css";
import { elsewhere, followToList } from "./toList";
import { browserTimeZone, useRules } from "./useRules";

const leaving = "Leave without saving your rules?";

// The rules: one box in plain English, and below it the hashtags askme read
// from them, each with its hours. Saving waits while askme reads them. If
// it cannot, the text is saved all the same, the old hashtags and hours
// stay, and the page offers to try again. Either way, saving re-sorts every
// open ask, and a last note says so, after the time zone the hours use. At
// the foot, the address of the account signed in, and Sign out.
export function Rules({ askFirst }: { askFirst: AskFirst }) {
  const auth = useAuth();
  const { loaded, save } = useRules();
  const { data, failed } = loaded;
  const boxId = useId();
  const readId = useId();
  // What the person has typed since the rules last loaded or saved.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? data?.text ?? "";
  const changed = data !== undefined && draft !== null && draft !== data.text;

  // Leaving with unsaved text asks first. The screens ask when Back or a
  // typed address changes the fragment, and the browser asks before the tab
  // closes.
  useEffect(() => {
    if (!changed) return;
    askFirst(leaving);
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      askFirst(null);
      window.removeEventListener("beforeunload", warn);
    };
  }, [changed, askFirst]);
  // This screen's own links ask before the address changes, so staying adds
  // nothing to the history. Once the person agrees, they are not asked again.
  // A link opened in a new tab or window leaves nothing, so it does not ask.
  const away = (event: MouseEvent) => {
    if (!changed || elsewhere(event)) return;
    if (window.confirm(leaving)) askFirst(null);
    else event.preventDefault();
  };

  // Signing out leaves the rules too, so unsaved text asks first, and once
  // the person agrees they are not asked again. The screen goes from the
  // address, so whoever signs in next starts at the list.
  const signOut = () => {
    if (changed) {
      if (!window.confirm(leaving)) return;
      askFirst(null);
    }
    const { pathname, search } = window.location;
    window.history.replaceState(null, "", pathname + search);
    auth.signOut();
  };

  const saveText = () => {
    const sent = text;
    save.mutate(sent, {
      // Text typed while the save was under way stays as typed.
      onSuccess: () => {
        setDraft((typed) => (typed === sent ? null : typed));
      },
    });
  };
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (changed) saveText();
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
              // A failed save's note goes once the text changes.
              if (save.isError) save.reset();
            }}
          />
          <button
            className={changed ? styles.save : styles.saved}
            type="submit"
            disabled={!changed || save.isPending}
          >
            Save rules
          </button>
          <Note
            failed={failed}
            pending={save.isPending}
            error={save.error}
            changed={changed}
            readFailed={data?.readFailed ?? false}
            saved={data !== undefined && (data.text !== "" || save.isSuccess)}
            onRetry={saveText}
          />
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
// and that saving re-sorts every open ask. A save takes this browser's time
// zone, so when another browser saved the rules, the note says which one
// saving here uses.
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
      {loaded && zone}Saving re-sorts every open ask.
    </p>
  );
}

// One short note under the button, giving the state.
function Note({
  failed,
  pending,
  error,
  changed,
  readFailed,
  saved,
  onRetry,
}: {
  failed: boolean;
  pending: boolean;
  error: Error | null;
  changed: boolean;
  readFailed: boolean;
  saved: boolean;
  onRetry: () => void;
}) {
  const retry = (
    <button className={styles.retry} type="button" onClick={onRetry}>
      Try again
    </button>
  );
  if (failed) {
    return (
      <p className={styles.note} role="status">
        Not connected. Trying again.
      </p>
    );
  }
  if (pending) {
    return (
      <p className={styles.note} role="status">
        Reading your rules.
      </p>
    );
  }
  if (error !== null) {
    return error instanceof Refusal && error.code === "rate_limited" ? (
      <p className={styles.note} role="status">
        Slow down a little. Try again in a few seconds.
      </p>
    ) : (
      <p className={styles.note} role="status">
        That didn&apos;t go through. {retry}
      </p>
    );
  }
  if (changed) return null;
  if (readFailed) {
    return (
      <p className={styles.note} role="status">
        askme couldn&apos;t read your rules just now. Your text is saved.{" "}
        {retry}
      </p>
    );
  }
  return saved ? (
    <p className={styles.note} role="status">
      Saved. The button wakes up when you change the text.
    </p>
  ) : null;
}
