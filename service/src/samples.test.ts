import { describe, expect, it } from "vitest";
import { fakeStore } from "../../test/fake-store";
import { askTool } from "./ask";
import { callerOf } from "./identity";
import { sampleAreas, sendSamples, shuffled } from "./samples";
import type { Counted, NewAsk, Posting } from "./store/store";

const { accountId: account } = callerOf({
  token: "test",
  clientId: "test",
  scopes: [],
  extra: { accountId: "user_1", requestId: "req-1" },
});
const now = new Date("2026-10-12T09:30:00.000Z");

describe("the sample asks", () => {
  it("come from three areas", () => {
    expect(sampleAreas).toHaveLength(3);
    expect(new Set(sampleAreas.map(({ area }) => area)).size).toBe(3);
  });

  it("give each area eight asks, each with its own summary", () => {
    for (const { asks } of sampleAreas) expect(asks).toHaveLength(8);
    const summaries = sampleAreas.flatMap(({ asks }) =>
      asks.map(({ summary }) => summary),
    );
    expect(new Set(summaries).size).toBe(summaries.length);
  });

  it("are each an ask the ask tool takes, as written", () => {
    for (const { area, asks } of sampleAreas) {
      for (const { summary, spokenDetail } of asks) {
        const parsed = askTool.input.safeParse({
          summary,
          area,
          spoken_detail: spokenDetail,
        });
        expect(parsed.success, summary).toBe(true);
        expect(parsed.data).toEqual({
          summary,
          area,
          spoken_detail: spokenDetail,
        });
      }
    }
  });

  it("name no hashtag, and hold no link, markdown or code", () => {
    for (const { area, asks } of sampleAreas) {
      for (const text of [area, ...asks.flatMap((ask) => Object.values(ask))]) {
        expect(text, text).not.toMatch(/[#*`_[\]<>]|https?:|www\./u);
      }
    }
  });

  it("are plain sentences, with no em dash and no exclamation mark", () => {
    for (const { asks } of sampleAreas) {
      for (const { summary, spokenDetail } of asks) {
        expect(`${summary} ${spokenDetail}`, summary).not.toMatch(/[—!]/u);
        expect(spokenDetail, summary).toMatch(/^[A-Z].*[.?]$/u);
      }
    }
  });
});

describe("the order samples are tried in", () => {
  it("holds every sample once", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    expect([...shuffled(items)].sort()).toEqual(items);
  });
});

function storeAnswering({
  counts = () => ({ counted: true }),
  posts = () => "posted",
}: {
  counts?: (call: number) => Counted;
  posts?: (ask: NewAsk, call: number) => Posting["kind"];
} = {}) {
  const posted: NewAsk[] = [];
  let counted = 0;
  let tried = 0;
  return {
    posted,
    counted: () => counted,
    store: fakeStore({
      countCall: (_, limit) => {
        if (limit !== "ask") {
          return Promise.reject(new Error(`Counted against ${limit}.`));
        }
        counted += 1;
        return Promise.resolve(counts(counted));
      },
      postAsk: (_, ask) => {
        tried += 1;
        const kind = posts(ask, tried);
        switch (kind) {
          case "posted":
            posted.push(ask);
            return Promise.resolve({
              kind,
              id: `ask${String(posted.length)}`,
              replaced: false,
            });
          case "matched":
            return Promise.resolve({ kind, id: "earlier" });
          case "over-cap":
            return Promise.resolve({
              kind,
              resetsAt: new Date("2026-10-13T00:00:00.000Z"),
            });
        }
      },
    }),
  };
}

const asWritten = <T>(items: readonly T[]): T[] => [...items];

const areaOf = (ask: NewAsk) => ask.area;

describe("sending sample asks", () => {
  it("posts one ask from each area, counting each against the rate", async () => {
    const fake = storeAnswering();
    const sent = await sendSamples(account, fake.store, now, asWritten);
    expect(sent).toEqual({ posted: ["ask1", "ask2", "ask3"] });
    expect(fake.posted.map(areaOf)).toEqual(
      sampleAreas.map(({ area }) => area),
    );
    expect(fake.posted).toEqual(
      sampleAreas.map(({ area, asks: [first] }) => ({ area, ...first })),
    );
    expect(fake.counted()).toBe(3);
  });

  it("tries each area's samples in the order it is given", async () => {
    const fake = storeAnswering();
    await sendSamples(account, fake.store, now, (items) =>
      [...items].reverse(),
    );
    expect(fake.posted.map(({ summary }) => summary)).toEqual(
      sampleAreas.map(({ asks }) => asks.at(-1)?.summary),
    );
  });

  it("tries the area's next sample when one was posted in the last ten minutes", async () => {
    const recent = new Set(
      sampleAreas.flatMap(({ asks }) =>
        asks.slice(0, 3).map(({ summary }) => summary),
      ),
    );
    const fake = storeAnswering({
      posts: (ask) => (recent.has(ask.summary) ? "matched" : "posted"),
    });
    const sent = await sendSamples(account, fake.store, now, asWritten);
    expect(sent.posted).toHaveLength(3);
    expect(fake.posted).toEqual(
      sampleAreas.map(({ area, asks }) => ({ area, ...asks[3] })),
    );
    expect(fake.counted()).toBe(3);
  });

  it("skips an area whose samples were all posted in the last ten minutes", async () => {
    const [firstArea] = sampleAreas;
    const fake = storeAnswering({
      posts: (ask) => (ask.area === firstArea?.area ? "matched" : "posted"),
    });
    const sent = await sendSamples(account, fake.store, now, asWritten);
    expect(sent).toEqual({ posted: ["ask1", "ask2"] });
    expect(fake.posted.map(areaOf)).toEqual(
      sampleAreas.slice(1).map(({ area }) => area),
    );
  });

  it("posts nothing when every sample was posted in the last ten minutes", async () => {
    const fake = storeAnswering({ posts: () => "matched" });
    expect(await sendSamples(account, fake.store, now, asWritten)).toEqual({
      posted: [],
    });
  });

  it("stops at the rate limit, keeping what it posted, and says how long to wait", async () => {
    const fake = storeAnswering({
      counts: (call) =>
        call === 1 ? { counted: true } : { counted: false, secondsLeft: 23 },
    });
    expect(await sendSamples(account, fake.store, now, asWritten)).toEqual({
      posted: ["ask1"],
      refused: { kind: "rate-limited", secondsLeft: 23 },
    });
    expect(fake.counted()).toBe(2);
  });

  it("stops at the daily cap, keeping what it posted, and says when the cap resets", async () => {
    const fake = storeAnswering({
      posts: (_, call) => (call === 1 ? "posted" : "over-cap"),
    });
    expect(await sendSamples(account, fake.store, now, asWritten)).toEqual({
      posted: ["ask1"],
      refused: {
        kind: "over-cap",
        resetsAt: new Date("2026-10-13T00:00:00.000Z"),
      },
    });
  });
});
