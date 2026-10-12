import { describe, expect, it } from "vitest";
import { everything, onTab, shownUnder } from "./tab";

describe("the asks a tab lists", () => {
  const asks = [
    { id: "work", sort: { hashtags: ["work"] } },
    { id: "work-and-shop", sort: { hashtags: ["work", "shop"] } },
    { id: "shop", sort: { hashtags: ["shop"] } },
    { id: "no-hashtag", sort: { hashtags: [] } },
    { id: "unsorted", sort: null },
  ];

  it("is every ask on Everything", () => {
    expect(onTab(asks, everything).map((ask) => ask.id)).toEqual([
      "work",
      "work-and-shop",
      "shop",
      "no-hashtag",
      "unsorted",
    ]);
  });

  it("is only the asks with that hashtag on a hashtag's tab", () => {
    expect(onTab(asks, "shop").map((ask) => ask.id)).toEqual([
      "work-and-shop",
      "shop",
    ]);
  });

  it("is none on a hashtag's tab that no ask carries", () => {
    expect(onTab(asks, "family")).toEqual([]);
  });
});

describe("the hashtag an ask is shown under", () => {
  const sort = { hashtags: ["work", "shop"] };

  it("is its first on Everything", () => {
    expect(shownUnder(sort, everything)).toBe("work");
  });

  it("is the tab's own on a hashtag's tab", () => {
    expect(shownUnder(sort, "shop")).toBe("shop");
  });

  it("is none on Everything for an ask sorted into no hashtag", () => {
    expect(shownUnder({ hashtags: [] }, everything)).toBeUndefined();
  });
});
