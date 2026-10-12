import { useCallback } from "react";
import type { PageAsk } from "../../shared/page-api";
import type { AskActions } from "./actions";
import { SessionIcon, SpeakerIcon } from "./Icon";
import { destinations, longSite } from "./links";
import { OutLink } from "./OutLink";
import { askColour, tagColour, type HashtagColour } from "./palette";
import { Pills } from "./Pills";
import { cardHref } from "./screen";
import type { Tab } from "./tab";
import styles from "./TopCard.module.css";
import { useSwipe } from "./useSwipe";
import { waiting } from "./waiting";

// The first ask in the list, given most of the screen: its hashtags, how
// long it has waited and its summary in large type, which opens its card.
// At desktop width its spoken text sits beside it. The card takes its first
// hashtag's colour on Everything, and the tab's on a hashtag's tab. Each
// pill keeps its own.
//
// Its main button leads to the action link, or the session link when there
// is none, and a second control leads to the session when the ask has both
// links. Listen reads the spoken text aloud where the browser can. Swiping
// the card dismisses it, and an opened ask is dimmed.
export function TopCard({
  ask,
  tab,
  now,
  colours,
  actions,
}: {
  ask: PageAsk;
  tab: Tab;
  now: number;
  colours: ReadonlyMap<string, HashtagColour>;
  actions: AskActions;
}) {
  const { id, sort, opened, spokenDetail } = ask;
  const { speak, markOpened, dismiss } = actions;
  const { main, session } = destinations(ask);
  const followed = useCallback(() => {
    markOpened(id);
  }, [markOpened, id]);
  const swipe = useSwipe(
    useCallback(() => {
      dismiss(id);
    }, [dismiss, id]),
  );
  return (
    <article
      className={styles.card}
      data-opened={opened ? "" : undefined}
      style={tagColour(askColour(sort, tab, colours))}
      {...swipe}
    >
      <div className={styles.meta}>
        <Pills sort={sort} colours={colours} />
        <span className={styles.when}>
          <span>{waiting(ask.postedAt, now)}</span>
          {opened && <span>Opened</span>}
        </span>
      </div>
      <a className={styles.summary} href={cardHref(id)} draggable={false}>
        {ask.summary}
      </a>
      <p className={styles.spoken}>{spokenDetail}</p>
      {(main !== undefined || speak !== undefined) && (
        <div className={styles.buttons}>
          {main !== undefined && (
            <OutLink
              className={styles.main}
              href={main.href}
              onFollowed={followed}
            >
              <span className={styles.label}>{main.label}</span>
              <span
                className={styles.site}
                data-long={longSite(main.site) ? "" : undefined}
              >
                {main.site}
              </span>
            </OutLink>
          )}
          {speak !== undefined && (
            <button
              className={styles.icon}
              type="button"
              aria-label="Listen"
              onClick={() => {
                speak(spokenDetail);
              }}
            >
              <SpeakerIcon />
            </button>
          )}
          {session !== undefined && (
            <OutLink
              className={styles.icon}
              href={session.href}
              label={`${session.label} on ${session.site}`}
              onFollowed={followed}
            >
              <SessionIcon />
            </OutLink>
          )}
        </div>
      )}
    </article>
  );
}
