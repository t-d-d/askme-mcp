import { describe, expect, it } from "vitest";
import { cardHref, cardIn, screenIn } from "./screen";

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
