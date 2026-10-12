import { describe, expect, it } from "vitest";
import { cardHref, cardIn, screenIn, stepsBackToList } from "./screen";

describe("the screen the address names", () => {
  it.each([
    ["#connect", "connect"],
    ["#rules", "rules"],
    ["", "asks"],
    ["#asks", "asks"],
    ["#ask/a1_B-2", "asks"],
    ["#Rules", "asks"],
  ])("is, for %j, %s", (hash, screen) => {
    expect(screenIn(hash)).toBe(screen);
  });
});

describe("the open card's address", () => {
  it("names the ask whose card is open", () => {
    expect(cardHref("a1_B-2")).toBe("#ask/a1_B-2");
    expect(cardIn(cardHref("a1_B-2"))).toBe("a1_B-2");
  });

  it.each(["", "#asks", "#rules", "#ask/", "#ask/a/b", "#ask/a b", "#ask/a?b"])(
    "opens no card for %j",
    (hash) => {
      expect(cardIn(hash)).toBeNull();
    },
  );
});

describe("the way back to the list", () => {
  const page = "https://askme.example/";
  const at = (hash: string) => `${page}${hash}`;

  it.each([
    [1, "the list is the entry behind", [at("")], at("#ask/a1")],
    [1, "the list is behind with its own name", [at("#asks")], at("#rules")],
    [
      2,
      "the list is further back",
      [at("#asks"), at("#rules")],
      at("#connect"),
    ],
    [
      2,
      "the nearest list is the latest of several",
      [at(""), at("#ask/a1"), at("#asks"), at("#rules")],
      at("#connect"),
    ],
  ])("is %i steps back when %s", (steps, _, earlier, here) => {
    expect(stepsBackToList(here, earlier)).toBe(steps);
  });

  it.each([
    ["nothing is behind", [], at("#ask/a1")],
    ["only cards and screens are behind", [at("#rules")], at("#connect")],
    [
      "another page is behind",
      ["https://askme.example/other", at("#rules")],
      at("#connect"),
    ],
    [
      "another site's list is behind",
      ["https://elsewhere.example/"],
      at("#rules"),
    ],
    ["the list behind has another query", [`${page}?a=1`], at("#rules")],
    ["an entry behind cannot be read", [at(""), null], at("#rules")],
  ])("is not there when %s", (_, earlier, here) => {
    expect(stepsBackToList(here, earlier)).toBeNull();
  });
});
