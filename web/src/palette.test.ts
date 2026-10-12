import { describe, expect, it } from "vitest";
import { colourOf, hashtagColours, palette, sortedColour } from "./palette";

const inOrder = Object.values(palette);

describe("a hashtag's colour", () => {
  it("is the next colour in the table, by the place it first appeared", () => {
    expect(colourOf(0)).toEqual(palette.blue);
    expect(colourOf(1)).toEqual(palette.orange);
    expect(colourOf(7)).toEqual(palette.gold);
  });

  it("starts the table again at the ninth hashtag", () => {
    expect(colourOf(8)).toEqual(inOrder[0]);
    expect(colourOf(9)).toEqual(inOrder[1]);
  });

  it("is looked up by name for the account's hashtags", () => {
    const colours = hashtagColours([
      { name: "shop", colour: 1 },
      { name: "work", colour: 0 },
    ]);
    expect(colours.get("work")).toEqual(palette.blue);
    expect(colours.get("shop")).toEqual(palette.orange);
  });
});

describe("the colour of an ask", () => {
  const colours = hashtagColours([
    { name: "work", colour: 0 },
    { name: "shop", colour: 1 },
  ]);

  it("is its first hashtag's", () => {
    expect(sortedColour({ hashtags: ["shop", "work"] }, colours)).toEqual(
      palette.orange,
    );
  });

  it("is ink when it was sorted into no hashtag", () => {
    expect(sortedColour({ hashtags: [] }, colours)).toEqual({
      strong: "var(--ink)",
      tint: "var(--neutral-tint)",
      ink: "var(--ink)",
    });
  });

  it("is ink when its hashtag has left the rules", () => {
    expect(sortedColour({ hashtags: ["family"] }, colours).strong).toBe(
      "var(--ink)",
    );
  });
});
