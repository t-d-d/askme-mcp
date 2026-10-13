import { useCallback, useId } from "react";
import type { PageAsk } from "../../shared/page-api";
import type { AskActions } from "./actions";
import { destinations } from "./links";
import styles from "./MoreAsks.module.css";
import { askColour, neutral, tagColour, type HashtagColour } from "./palette";
import { cardHref } from "./screen";
import { SiteName } from "./SiteName";
import type { Tab } from "./tab";
import { useSwipe } from "./useSwipe";
import { age } from "./waiting";

// With no rows the count still shows, to keep the list's place beside the
// top card at desktop width.
export function MoreAsks({
  asks,
  tab,
  now,
  serviceAhead,
  colours,
  actions,
}: {
  asks: PageAsk[];
  tab: Tab;
  now: number;
  serviceAhead: number;
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
              serviceAhead={serviceAhead}
              colours={colours}
              dismiss={actions.dismiss}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function Row({
  ask,
  tab,
  now,
  serviceAhead,
  colours,
  dismiss,
}: {
  ask: PageAsk;
  tab: Tab;
  now: number;
  serviceAhead: number;
  colours: ReadonlyMap<string, HashtagColour>;
  dismiss: AskActions["dismiss"];
}) {
  const { id, summary, postedAt, sort, opened } = ask;
  const { main } = destinations(ask);
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
            sort.hashtags.map((name) => (
              <span
                className={styles.pill}
                key={name}
                style={tagColour(colours.get(name) ?? neutral)}
              >
                #{name}
              </span>
            ))
          )}
          <span>{age(postedAt, now, serviceAhead)}</span>
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
