import { useRef } from "react";
import type { PageAsk } from "../../shared/page-api";
import type { AskActions } from "./actions";
import { BackIcon, SpeakerIcon } from "./Icon";
import { destinations } from "./links";
import styles from "./OpenCard.module.css";
import { OutLink } from "./OutLink";
import { askColour, tagColour, type HashtagColour } from "./palette";
import { Pills } from "./Pills";
import { SiteName } from "./SiteName";
import { slide } from "./slide";
import { listenLength } from "./speech";
import type { Tab } from "./tab";
import { backToList, followToList } from "./toList";
import { waiting } from "./waiting";

// The reason is the sorting model's words, so it is plain text only
// (untrusted-ask-text.md).
export function OpenCard({
  ask,
  tab,
  now,
  serviceAhead,
  colours,
  actions,
  noted,
}: {
  ask: PageAsk;
  tab: Tab;
  now: number;
  serviceAhead: number;
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
  // The card stays until the slide draws the list, so Dismiss can be tapped
  // again before then.
  const dismissing = useRef(false);
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
            if (dismissing.current) return;
            dismissing.current = true;
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
          <span className={styles.age}>
            {waiting(ask.postedAt, now, serviceAhead)}
          </span>
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
            <span className={styles.site}>
              <SiteName site={main.site} />
            </span>
          </OutLink>
          {session !== undefined && (
            <OutLink
              className={styles.second}
              href={session.href}
              onFollowed={followed}
            >
              <span className={styles.label}>{session.label}</span>
              <span className={styles.site}>
                <SiteName site={session.site} />
              </span>
            </OutLink>
          )}
        </div>
      )}
    </div>
  );
}
