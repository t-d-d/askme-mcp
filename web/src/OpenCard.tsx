import type { PageAsk } from "../../shared/page-api";
import type { AskActions } from "./actions";
import { BackIcon, SpeakerIcon } from "./Icon";
import { destinations } from "./links";
import styles from "./OpenCard.module.css";
import { OutLink } from "./OutLink";
import { askColour, tagColour, type HashtagColour } from "./palette";
import { Pills } from "./Pills";
import { slide } from "./slide";
import { listenLength } from "./speech";
import type { Tab } from "./tab";
import { backToList, followToList } from "./toList";
import { waiting } from "./waiting";

// One ask, open on a white screen (docs/design.md, "The open card"): its
// hashtags and how long it has waited, the summary, Listen where the
// browser can speak, the spoken text, and the reason it was sorted as it
// was. At the foot, the main button, and under it an outlined one for the
// session when the ask has both links. "All asks" goes back, and "Dismiss"
// dismisses the ask and goes back.
//
// While a note shows at the foot of the screen, the card leaves room for it,
// so it covers none of the buttons.
//
// The reason is the sorting model's words, so it is plain text only
// (untrusted-ask-text.md).
export function OpenCard({
  ask,
  tab,
  now,
  colours,
  actions,
  noted,
}: {
  ask: PageAsk;
  tab: Tab;
  now: number;
  colours: ReadonlyMap<string, HashtagColour>;
  actions: AskActions;
  noted: boolean;
}) {
  const { id, sort, spokenDetail } = ask;
  const { speak, markOpened, dismiss } = actions;
  const { main, session } = destinations(ask);
  const followed = () => {
    markOpened(id);
  };
  return (
    <div
      className={styles.screen}
      data-noted={noted ? "" : undefined}
      style={tagColour(askColour(sort, tab, colours))}
    >
      <header className={styles.header}>
        <a className={styles.back} href="#asks" onClick={followToList}>
          <BackIcon />
          All asks
        </a>
        <button
          className={styles.dismiss}
          type="button"
          onClick={() => {
            // The card goes as the ask does, so it slides out then.
            slide(() => {
              dismiss(id);
              // The card is gone, so Back does not come back to it.
              backToList();
            });
          }}
        >
          Dismiss
        </button>
      </header>
      <main className={styles.body}>
        <div className={styles.meta}>
          <Pills sort={sort} colours={colours} />
          <span className={styles.age}>{waiting(ask.postedAt, now)}</span>
        </div>
        <h1 className={styles.summary}>{ask.summary}</h1>
        {speak !== undefined && (
          <button
            className={styles.listen}
            type="button"
            onClick={() => {
              speak(spokenDetail);
            }}
          >
            <SpeakerIcon />
            <span className={styles.label}>Listen</span>
            <span className={styles.length}>{listenLength(spokenDetail)}</span>
          </button>
        )}
        <p className={styles.spoken}>{spokenDetail}</p>
        {sort !== null && <p className={styles.reason}>{sort.reason}</p>}
      </main>
      {main !== undefined && (
        <div className={styles.foot}>
          <OutLink
            className={styles.main}
            href={main.href}
            onFollowed={followed}
          >
            <span className={styles.label}>{main.label}</span>
            <span className={styles.site}>{main.site}</span>
          </OutLink>
          {session !== undefined && (
            <OutLink
              className={styles.second}
              href={session.href}
              onFollowed={followed}
            >
              <span className={styles.label}>{session.label}</span>
              <span className={styles.site}>{session.site}</span>
            </OutLink>
          )}
        </div>
      )}
    </div>
  );
}
