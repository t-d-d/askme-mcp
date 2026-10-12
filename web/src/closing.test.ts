import { describe, expect, it } from "vitest";
import { focusOnClosing } from "./closing";

// The list as it stood when b's card opened.
const stood = ["a", "b", "c", "d"];

describe("the ask whose link takes focus as its card closes", () => {
  it.each([
    ["the ask is where it was", ["a", "b", "c", "d"]],
    ["new asks came in above it", ["x", "a", "y", "b", "c", "d"]],
    ["an ask above it left", ["b", "c", "d"]],
    ["an ask below it left", ["a", "b", "d"]],
  ])("is its own when %s", (_, order) => {
    expect(focusOnClosing("b", stood, order)).toBe("b");
  });

  it.each([
    ["it left the list", ["a", "c", "d"]],
    ["it sank below the ask after it", ["a", "c", "b", "d"]],
    ["it sank to the foot of the list", ["a", "c", "d", "b"]],
    ["it rose above the ask before it", ["b", "a", "c", "d"]],
  ])("is the one that came after it when %s", (_, order) => {
    expect(focusOnClosing("b", stood, order)).toBe("c");
  });

  it("skips the asks after it that have also left", () => {
    expect(focusOnClosing("b", stood, ["a", "d"])).toBe("d");
  });

  it.each([
    ["it was the last and left", "d", ["a", "b", "c"], "c"],
    ["every ask after it left", "b", ["a"], "a"],
    ["every ask after it left, and it moved", "b", ["b", "a"], "a"],
  ])("is the last ask's when %s", (_, card, order, last) => {
    expect(focusOnClosing(card, stood, order)).toBe(last);
  });

  it("is none when the list is empty", () => {
    expect(focusOnClosing("b", stood, [])).toBeUndefined();
  });
});
