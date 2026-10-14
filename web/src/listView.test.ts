import { describe, expect, it } from "vitest";
import type { AsksAnswer, Hashtag, PageAsk } from "../../shared/page-api";
import { pageAsk } from "../../test/asks";
import { listView } from "./listView";
import { everything, type Tab } from "./tab";

// Monday 12 October 2026, 7pm in London, where work's hours have closed.
const evening = Date.parse("2026-10-12T18:00:00.000Z");
const minute = 60_000;

const work: Hashtag = {
  name: "work",
  colour: 0,
  hours: [
    { days: ["mon", "tue", "wed", "thu", "fri"], from: "08:00", to: "18:00" },
  ],
};
const shop: Hashtag = { name: "shop", colour: 1 };

const ask = (
  id: string,
  hashtags: string[] | null,
  more: Partial<PageAsk> = {},
): PageAsk =>
  pageAsk({
    id,
    postedAt: new Date(evening - 30 * minute).toISOString(),
    sort:
      hashtags === null
        ? null
        : { hashtags, level: "normal", reason: "Sorted." },
    ...more,
  });

const at = (offset: number) => new Date(evening + offset).toISOString();

const answerOf = (
  asks: PageAsk[],
  more: Partial<AsksAnswer> = {},
): AsksAnswer => ({
  version: 3,
  everAsked: true,
  hashtags: [shop, work],
  formerHashtags: [],
  timeZone: "Europe/London",
  asks,
  ...more,
});

const none: ReadonlySet<string> = new Set();

const view = ({
  answer,
  polledAt = evening,
  serviceAhead = 0,
  dismissed = none,
  opened = none,
  card = null,
  chosen = everything,
  showingHeld = false,
  showingLapsed = false,
}: {
  answer: AsksAnswer | undefined;
  polledAt?: number;
  serviceAhead?: number;
  dismissed?: ReadonlySet<string>;
  opened?: ReadonlySet<string>;
  card?: string | null;
  chosen?: Tab;
  showingHeld?: boolean;
  showingLapsed?: boolean;
}) =>
  listView({
    answer,
    polledAt,
    serviceAhead,
    dismissed,
    opened,
    card,
    chosen,
    showingHeld,
    showingLapsed,
  });

const ids = (asks: readonly { id: string }[]) => asks.map(({ id }) => id);

describe("the list before the first answer", () => {
  it("is empty, on Everything, and not all clear", () => {
    const list = view({ answer: undefined, chosen: "shop" });
    expect(list.asks).toEqual([]);
    expect(list.shown).toEqual([]);
    expect(list.open).toBeUndefined();
    expect(list.tab).toBe(everything);
    expect(list.allClear).toBe(false);
    expect(list.heldHere).toBe(0);
    expect(list.lapsedHere).toBe(0);
    expect(list.sorting).toBeNull();
    expect(list.coloured).toEqual([]);
  });
});

describe("which asks the list holds", () => {
  it("leaves out an ask dismissed here, and marks one opened here", () => {
    const list = view({
      answer: answerOf([ask("a", ["shop"]), ask("b", ["shop"])]),
      dismissed: new Set(["a"]),
      opened: new Set(["b"]),
    });
    expect(ids(list.asks)).toEqual(["b"]);
    expect(list.asks[0]?.opened).toBe(true);
    expect(ids(list.shown)).toEqual(["b"]);
  });

  it("shows the asks in list order", () => {
    const list = view({
      answer: answerOf([
        ask("a", ["shop"], { postedAt: at(-40 * minute) }),
        ask("b", ["shop"], { postedAt: at(-50 * minute) }),
      ]),
    });
    expect(ids(list.shown)).toEqual(["b", "a"]);
  });

  it("colours the current hashtags and the former ones", () => {
    const former = { name: "home", colour: 2 };
    const list = view({ answer: answerOf([], { formerHashtags: [former] }) });
    expect(list.coloured).toEqual([shop, work, former]);
  });
});

describe("held and lapsed asks", () => {
  it("holds back an ask whose hashtag's hours are closed, and counts it", () => {
    const list = view({
      answer: answerOf([ask("a", ["work"]), ask("b", ["shop"])]),
    });
    expect(ids(list.shown)).toEqual(["b"]);
    expect(list.heldHere).toBe(1);
    expect(list.lapsedHere).toBe(0);
  });

  it("shows held asks while they are showing", () => {
    const list = view({
      answer: answerOf([ask("a", ["work"]), ask("b", ["shop"])]),
      showingHeld: true,
    });
    expect(ids(list.shown)).toEqual(["a", "b"]);
    expect(list.heldHere).toBe(1);
  });

  it("holds back an ask whose time has passed as lapsed, and shows it while lapsed asks are showing", () => {
    const answer = answerOf([
      ask("a", ["shop"], { lapsesAt: at(-minute) }),
      ask("b", ["shop"]),
    ]);
    expect(ids(view({ answer }).shown)).toEqual(["b"]);
    expect(view({ answer }).lapsedHere).toBe(1);
    expect(ids(view({ answer, showingLapsed: true }).shown)).toEqual([
      "b",
      "a",
    ]);
    expect(ids(view({ answer, showingHeld: true }).shown)).toEqual(["b"]);
  });

  it("finds an ask lapsed by the service's clock", () => {
    const answer = answerOf([
      ask("a", ["shop"], { lapsesAt: at(minute) }),
      ask("b", ["shop"]),
    ]);
    expect(view({ answer }).lapsedHere).toBe(0);
    expect(view({ answer, serviceAhead: minute }).lapsedHere).toBe(1);
  });

  it("counts a lapsed ask as lapsed, not held, whatever its hours", () => {
    const list = view({
      answer: answerOf([
        ask("a", ["work"], { lapsesAt: at(-minute) }),
        ask("b", ["shop"]),
      ]),
      showingLapsed: true,
    });
    expect(list.heldHere).toBe(0);
    expect(list.lapsedHere).toBe(1);
    // Shown as lapsed, though its hours are closed and held asks are hidden.
    expect(ids(list.shown)).toEqual(["b", "a"]);
  });

  it("counts held and lapsed asks over the list as polled, so one dismissed here still counts", () => {
    const list = view({
      answer: answerOf([
        ask("a", ["work"]),
        ask("b", ["shop"], { lapsesAt: at(-minute) }),
        ask("c", ["shop"]),
      ]),
      dismissed: new Set(["a", "b"]),
      showingHeld: true,
      showingLapsed: true,
    });
    expect(ids(list.asks)).toEqual(["c"]);
    // Neither is on the tab any more, but both keep their asks showing.
    expect(list.heldHere).toBe(0);
    expect(list.lapsedHere).toBe(0);
    expect(list.keepHeld).toBe(true);
    expect(list.keepLapsed).toBe(true);
  });

  it("counts on the tab the held and lapsed asks it lists", () => {
    const answer = answerOf([
      ask("a", ["work"]),
      ask("b", ["shop"], { lapsesAt: at(-minute) }),
      ask("c", ["shop"]),
    ]);
    const onShop = view({ answer, chosen: "shop" });
    expect(onShop.heldHere).toBe(0);
    expect(onShop.lapsedHere).toBe(1);
    const onWork = view({ answer, chosen: "work" });
    expect(onWork.heldHere).toBe(1);
    expect(onWork.lapsedHere).toBe(0);
  });

  it("holds nothing back by a hashtag that has left the rules, whatever its hours", () => {
    const list = view({
      answer: answerOf([ask("a", ["work"])], {
        hashtags: [shop],
        formerHashtags: [work],
      }),
    });
    expect(ids(list.shown)).toEqual(["a"]);
    expect(list.heldHere).toBe(0);
    expect(list.keepHeld).toBe(false);
  });

  it("holds nothing back in a time zone this browser does not know", () => {
    const list = view({
      answer: answerOf([ask("a", ["work"])], { timeZone: "Nowhere/At_All" }),
    });
    expect(ids(list.shown)).toEqual(["a"]);
  });

  it("keeps held and lapsed asks showing while any are held or lapsed, and hides them again once none is", () => {
    const held = answerOf([ask("a", ["work"])]);
    const lapsed = answerOf([ask("a", ["shop"], { lapsesAt: at(-minute) })]);
    const neither = answerOf([ask("a", ["shop"])]);
    const showing = { showingHeld: true, showingLapsed: true };
    expect(view({ answer: held, ...showing })).toMatchObject({
      keepHeld: true,
      keepLapsed: false,
    });
    expect(view({ answer: lapsed, ...showing })).toMatchObject({
      keepHeld: false,
      keepLapsed: true,
    });
    expect(view({ answer: neither, ...showing })).toMatchObject({
      keepHeld: false,
      keepLapsed: false,
    });
    expect(view({ answer: held })).toMatchObject({
      keepHeld: false,
      keepLapsed: false,
    });
  });
});

describe("the tab", () => {
  it("stays on a hashtag the rules name", () => {
    const list = view({
      answer: answerOf([ask("a", ["shop"]), ask("b", null)]),
      chosen: "shop",
    });
    expect(list.tab).toBe("shop");
    expect(ids(list.shown)).toEqual(["a"]);
  });

  it("goes back to Everything when its hashtag leaves the rules", () => {
    const list = view({
      answer: answerOf([ask("a", ["shop"]), ask("b", null)], {
        hashtags: [work],
        formerHashtags: [shop],
      }),
      chosen: "shop",
    });
    expect(list.tab).toBe(everything);
    expect(ids(list.shown)).toEqual(["a", "b"]);
  });

  it("goes back to Everything when the whole list is all clear", () => {
    const list = view({
      answer: answerOf([ask("a", ["work"])]),
      chosen: "work",
    });
    expect(list.allClear).toBe(true);
    expect(list.tab).toBe(everything);
  });

  it("stays on a hashtag with nothing waiting, while the list has asks waiting elsewhere", () => {
    const list = view({
      answer: answerOf([ask("a", ["work"]), ask("b", ["shop"])]),
      chosen: "work",
    });
    expect(list.allClear).toBe(false);
    expect(list.tab).toBe("work");
    expect(list.shown).toEqual([]);
  });
});

describe("all clear", () => {
  it("is all clear with nothing waiting on an account that has had asks", () => {
    expect(view({ answer: answerOf([]) }).allClear).toBe(true);
  });

  it("is not all clear on an account that has never had an ask", () => {
    expect(view({ answer: answerOf([], { everAsked: false }) }).allClear).toBe(
      false,
    );
  });

  it("is not all clear while held asks are showing", () => {
    expect(
      view({ answer: answerOf([ask("a", ["work"])]), showingHeld: true })
        .allClear,
    ).toBe(false);
  });

  it("is all clear once the last waiting ask is dismissed here", () => {
    expect(
      view({
        answer: answerOf([ask("a", ["shop"])]),
        dismissed: new Set(["a"]),
      }).allClear,
    ).toBe(true);
  });
});

describe("an open card", () => {
  it("is the ask the address names, as the list holds it", () => {
    const list = view({
      answer: answerOf([ask("a", ["shop"]), ask("b", ["shop"])]),
      opened: new Set(["b"]),
      card: "b",
    });
    expect(list.open?.id).toBe("b");
    expect(list.open?.opened).toBe(true);
  });

  it("is none when the ask it names is dismissed here, or not in the list", () => {
    const answer = answerOf([ask("a", ["shop"])]);
    expect(
      view({ answer, card: "a", dismissed: new Set(["a"]) }).open,
    ).toBeUndefined();
    expect(view({ answer, card: "z" }).open).toBeUndefined();
  });

  it("keeps the list's tab, and does not count toward all clear, though every ask behind it is held", () => {
    const list = view({
      answer: answerOf([ask("a", ["work"])]),
      card: "a",
      chosen: "work",
    });
    expect(list.allClear).toBe(false);
    expect(list.tab).toBe("work");
  });
});

describe("the sorting line", () => {
  it("counts every ask on every tab, held ones included", () => {
    const list = view({
      answer: answerOf([
        ask("a", ["work"], { sortingUntil: at(minute) }),
        ask("b", ["shop"], { sortingUntil: at(minute) }),
        ask("c", ["shop"]),
      ]),
      chosen: "shop",
    });
    expect(list.sorting).toBe("Sorting 2 asks with your rules");
  });

  it("counts the list after dismissals made here", () => {
    const list = view({
      answer: answerOf([
        ask("a", ["shop"], { sortingUntil: at(minute) }),
        ask("b", ["shop"], { sortingUntil: at(minute) }),
      ]),
      dismissed: new Set(["a"]),
    });
    expect(list.sorting).toBe("Sorting 1 ask with your rules");
  });

  it("finds an ask stopped by the service's clock", () => {
    const answer = answerOf([ask("a", ["shop"], { sortingUntil: at(minute) })]);
    expect(view({ answer, serviceAhead: minute }).sorting).toBe(
      "1 ask couldn't be sorted. Saving your rules tries again.",
    );
  });

  it("says the limit is reached while the cap is spent, by the service's clock", () => {
    const answer = answerOf(
      [ask("a", ["shop"], { sortingUntil: at(minute) })],
      {
        modelCapResetsAt: at(minute),
      },
    );
    expect(view({ answer }).sorting).toMatch(
      /^Today's sorting limit is reached\. It resets at \d\d:\d\d\.$/u,
    );
    expect(view({ answer, serviceAhead: minute }).sorting).toBe(
      "1 ask couldn't be sorted. Saving your rules tries again.",
    );
  });

  it("is not there when every ask is sorted with the rules in force", () => {
    expect(view({ answer: answerOf([ask("a", ["shop"])]) }).sorting).toBeNull();
  });
});
