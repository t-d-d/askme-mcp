import { useCallback, useId } from "react";
import type { PageAsk } from "../../shared/page-api";
import type { AskActions } from "./actions";
import { destinations } from "./links";
import styles from "./MoreAsks.module.css";
import { askColour, tagColour, type HashtagColour } from "./palette";
import { cardHref } from "./screen";
import { SiteName } from "./SiteName";
import { shownUnder, type Tab } from "./tab";
import { useSwipe } from "./useSwipe";
import { age } from "./waiting";

// Every ask after the first, as compact rows under a count. With none, the
// count says nothing else is waiting, and keeps the list's place beside the
// top card at desktop width. Each row shows the hashtag it is shown under,
// in that hashtag's colour: its first on Everything, and the tab's on a
// hashtag's tab.
export function MoreAsks({
  asks,
  tab,
  now,
  colours,
  actions,
}: {
  asks: PageAsk[];
  tab: Tab;
  now: number;
  colours: ReadonlyMap<string, HashtagColour>;
  actions: AskActions;
}) {
  const heading = useId();
  return (
    <section className={styles.more} aria-labelledby={heading}>
      <h2 className={styles.count} id={heading}>
        {asks.length === 0
          ? "Nothing else waiting"
          : `${String(asks.length)} more waiting`}
      </h2>
      {asks.length > 0 && (
        <ol className={styles.rows}>
          {asks.map((ask) => (
            <Row
              key={ask.id}
              ask={ask}
              tab={tab}
              now={now}
              colours={colours}
              dismiss={actions.dismiss}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

// A row opens the ask's card, where it can be heard, read in full and
// dismissed, and where its links are. It names the site its main button
// leads to. Swiping it dismisses the ask, and an opened ask is dimmed and
// says so.
function Row({
  ask,
  tab,
  now,
  colours,
  dismiss,
}: {
  ask: PageAsk;
  tab: Tab;
  now: number;
  colours: ReadonlyMap<string, HashtagColour>;
  dismiss: AskActions["dismiss"];
}) {
  const { id, summary, postedAt, sort, opened } = ask;
  const { main } = destinations(ask);
  const shown = sort === null ? undefined : shownUnder(sort, tab);
  const swipe = useSwipe(
    useCallback(() => {
      dismiss(id);
    }, [dismiss, id]),
  );
  return (
    <li
      className={styles.row}
      data-opened={opened ? "" : undefined}
      style={tagColour(askColour(sort, tab, colours))}
      {...swipe}
    >
      <a className={styles.link} href={cardHref(id)} draggable={false}>
        <span className={styles.summary}>{summary}</span>
        <span className={styles.meta}>
          {sort === null ? (
            <span className={styles.pill}>Not sorted yet</span>
          ) : (
            shown !== undefined && <span className={styles.pill}>#{shown}</span>
          )}
          <span>{age(postedAt, now)}</span>
          {opened && <span>Opened</span>}
          {main !== undefined && (
            <span className={styles.site}>
              <SiteName site={main.site} />
            </span>
          )}
        </span>
      </a>
    </li>
  );
}
