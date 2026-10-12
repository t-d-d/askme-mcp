import { describe, expect, it } from "vitest";
import { cardHref, cardIn } from "./screen";

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
