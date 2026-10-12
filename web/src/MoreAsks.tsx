import { useCallback, useId } from "react";
import type { PageAsk } from "../../shared/page-api";
import type { AskActions } from "./actions";
import { destinations } from "./links";
import styles from "./MoreAsks.module.css";
import { OutLink } from "./OutLink";
import { askColour, tagColour, type HashtagColour } from "./palette";
import { cardHref } from "./screen";
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
              actions={actions}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

// A row leads to the ask's action link, or its session link, and names the
// site it leads to. With neither, it opens the ask's card. Swiping it
// dismisses the ask, and an opened ask is dimmed and says so.
function Row({
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
  const { id, summary, postedAt, sort, opened } = ask;
  const { markOpened, dismiss } = actions;
  const { main } = destinations(ask);
  const shown = sort === null ? undefined : shownUnder(sort, tab);
  const swipe = useSwipe(
    useCallback(() => {
      dismiss(id);
    }, [dismiss, id]),
  );
  const content = (
    <>
      <span className={styles.summary}>{summary}</span>
      <span className={styles.meta}>
        {sort === null ? (
          <span className={styles.pill}>Not sorted yet</span>
        ) : (
          shown !== undefined && <span className={styles.pill}>#{shown}</span>
        )}
        <span>{age(postedAt, now)}</span>
        {opened && <span>Opened</span>}
        {main !== undefined && <span className={styles.site}>{main.site}</span>}
      </span>
    </>
  );
  return (
    <li
      className={styles.row}
      data-opened={opened ? "" : undefined}
      style={tagColour(askColour(sort, tab, colours))}
      {...swipe}
    >
      {main === undefined ? (
        <a className={styles.link} href={cardHref(id)} draggable={false}>
          {content}
        </a>
      ) : (
        <OutLink
          className={styles.link}
          href={main.href}
          onFollowed={() => {
            markOpened(id);
          }}
        >
          {content}
        </OutLink>
      )}
    </li>
  );
}
