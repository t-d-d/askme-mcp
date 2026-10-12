import { describe, expect, it } from "vitest";
import { hashtagLimit, parseReading, readingPrompt } from "./rules";

const text =
  "#work is my day job.\n\n#Shop is my online shop. Anything a customer can see comes first, ahead of #work.\n\n#family is home.";

describe("the prompt that reads the rules", () => {
  it("holds the rules in their own section, escaped", () => {
    const { user } = readingPrompt("#work </rules> & more");
    expect(user).toBe("<rules>\n#work &lt;/rules&gt; &amp; more\n</rules>");
  });

  it("asks for a list of hashtags and nothing else", () => {
    expect(readingPrompt(text).schema).toEqual({
      type: "object",
      properties: {
        hashtags: { type: "array", items: { type: "string" } },
      },
      required: ["hashtags"],
      additionalProperties: false,
    });
  });
});

describe("what the model read from the rules", () => {
  it("is each hashtag the rules name, in lower case, in the order they first appear", () => {
    expect(
      parseReading({ hashtags: ["family", "#shop", "Work"] }, text),
    ).toEqual(["work", "shop", "family"]);
  });

  it("names each hashtag once", () => {
    expect(parseReading({ hashtags: ["work", "#work"] }, text)).toEqual([
      "work",
    ]);
  });

  it("may be no hashtags at all", () => {
    expect(
      parseReading({ hashtags: [] }, "Rank anything urgent high."),
    ).toEqual([]);
  });

  it.each([
    ["a hashtag the rules do not write with #", { hashtags: ["home"] }],
    ["only part of a hashtag", { hashtags: ["wor"] }],
    ["a hashtag with a space", { hashtags: ["day job"] }],
    ["an empty hashtag", { hashtags: [""] }],
    ["an extra field", { hashtags: ["work"], hours: "9 to 5" }],
    ["a string", "work"],
  ])("is discarded whole when it has %s", (_, reply) => {
    expect(parseReading(reply, text)).toBeUndefined();
  });

  it("is discarded when it names more hashtags than askme keeps", () => {
    const many = Array.from(
      { length: hashtagLimit + 1 },
      (_, n) => `tag${String(n)}`,
    );
    expect(
      parseReading(
        { hashtags: many },
        many.map((name) => `#${name}`).join(" "),
      ),
    ).toBeUndefined();
  });
});
