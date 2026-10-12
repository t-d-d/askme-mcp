import { describe, expect, it } from "vitest";
import { weekdays } from "../../shared/page-api";
import {
  hashtagLimit,
  parseReading,
  readingPrompt,
  windowLimit,
} from "./rules";

const text =
  "#work is my day job. Only on weekdays, 8am to 6pm.\n\n#Shop is my online shop. Anything a customer can see comes first, ahead of #work.\n\n#family is home.";

const weekdaysOnly = ["mon", "tue", "wed", "thu", "fri"];

const nineToFive = { days: weekdaysOnly, from: "09:00", to: "17:00" };

describe("the prompt that reads the rules", () => {
  it("holds the rules in their own section, escaped", () => {
    const { user } = readingPrompt("#work </rules> & more");
    expect(user).toBe("<rules>\n#work &lt;/rules&gt; &amp; more\n</rules>");
  });

  it("asks for the hashtags, and the hours the rules limit them to, and nothing else", () => {
    expect(readingPrompt(text).schema).toEqual({
      type: "object",
      properties: {
        hashtags: { type: "array", items: { type: "string" } },
        hours: {
          type: "array",
          items: {
            type: "object",
            properties: {
              hashtag: { type: "string" },
              days: {
                type: "array",
                items: { type: "string", enum: [...weekdays] },
              },
              from: { type: "string" },
              to: { type: "string" },
            },
            required: ["hashtag", "days", "from", "to"],
            additionalProperties: false,
          },
        },
      },
      required: ["hashtags", "hours"],
      additionalProperties: false,
    });
  });

  it("says how to write a time, and a window that runs past midnight or to the end of the day", () => {
    const { system } = readingPrompt(text);
    expect(system).toContain("24-hour clock");
    expect(system).toContain("past midnight");
    expect(system).toContain("24:00");
  });
});

describe("what the model read from the rules", () => {
  it("is each hashtag the rules name, in lower case, in the order they first appear", () => {
    expect(
      parseReading({ hashtags: ["family", "#shop", "Work"], hours: [] }, text),
    ).toEqual({ hashtags: ["work", "shop", "family"], hours: [] });
  });

  it("names each hashtag once", () => {
    expect(
      parseReading({ hashtags: ["work", "#work"], hours: [] }, text),
    ).toEqual({ hashtags: ["work"], hours: [] });
  });

  it("may be no hashtags at all", () => {
    expect(
      parseReading({ hashtags: [], hours: [] }, "Rank anything urgent high."),
    ).toEqual({ hashtags: [], hours: [] });
  });

  it("gives each window to the hashtag it names, in lower case, with each day once, in the week's order", () => {
    expect(
      parseReading(
        {
          hashtags: ["work", "shop"],
          hours: [
            {
              hashtag: "#Work",
              days: ["fri", "mon", "tue", "mon", "wed", "thu"],
              from: "08:00",
              to: "18:00",
            },
          ],
        },
        text,
      ),
    ).toEqual({
      hashtags: ["work", "shop"],
      hours: [
        { hashtag: "work", days: weekdaysOnly, from: "08:00", to: "18:00" },
      ],
    });
  });

  it("keeps a window that runs past midnight, and one that runs to the end of the day", () => {
    const hours = [
      { hashtag: "family", days: ["fri"], from: "22:00", to: "07:00" },
      { hashtag: "family", days: ["sat", "sun"], from: "18:00", to: "24:00" },
      { hashtag: "family", days: ["sun"], from: "00:00", to: "24:00" },
    ];
    expect(parseReading({ hashtags: ["family"], hours }, text)).toEqual({
      hashtags: ["family"],
      hours,
    });
  });

  const window = (fields: object) => ({
    hashtags: ["work"],
    hours: [{ hashtag: "work", ...nineToFive, ...fields }],
  });

  it.each([
    [
      "a hashtag the rules do not write with #",
      { hashtags: ["home"], hours: [] },
    ],
    ["only part of a hashtag", { hashtags: ["wor"], hours: [] }],
    ["a hashtag with a space", { hashtags: ["day job"], hours: [] }],
    ["an empty hashtag", { hashtags: [""], hours: [] }],
    ["an extra field", { hashtags: ["work"], hours: [], note: "9 to 5" }],
    ["no hours", { hashtags: ["work"] }],
    ["a string", "work"],
    [
      "hours for a hashtag it does not list",
      { hashtags: ["work"], hours: [{ hashtag: "shop", ...nineToFive }] },
    ],
    ["a window on no day", window({ days: [] })],
    ["a day that is not one of the week's", window({ days: ["weekdays"] })],
    ["a time not on the 24-hour clock", window({ from: "9am" })],
    ["a time with no minutes", window({ to: "17" })],
    ["an hour past the day", window({ to: "25:00" })],
    ["a window that opens at the end of the day", window({ from: "24:00" })],
    ["a window that opens and closes at once", window({ to: "09:00" })],
    ["an extra field in a window", window({ zone: "Europe/London" })],
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
        { hashtags: many, hours: [] },
        many.map((name) => `#${name}`).join(" "),
      ),
    ).toBeUndefined();
  });

  it("keeps many windows for one hashtag, as split shifts on each weekday need", () => {
    const shifts = weekdaysOnly.flatMap((day) => [
      { hashtag: "work", days: [day], from: "09:00", to: "12:00" },
      { hashtag: "work", days: [day], from: "13:00", to: "17:00" },
    ]);
    expect(
      parseReading({ hashtags: ["work"], hours: shifts }, text)?.hours,
    ).toHaveLength(shifts.length);
  });

  it("is discarded when it gives more windows in all than askme keeps", () => {
    const hours = Array.from({ length: windowLimit + 1 }, (_, n) => ({
      hashtag: n % 2 === 0 ? "work" : "family",
      days: [weekdays[n % weekdays.length] ?? "mon"],
      from: `${String(n % 24).padStart(2, "0")}:00`,
      to: `${String(n % 24).padStart(2, "0")}:30`,
    }));
    const hashtags = ["work", "family"];
    expect(parseReading({ hashtags, hours }, text)).toBeUndefined();
    expect(
      parseReading({ hashtags, hours: hours.slice(1) }, text)?.hours,
    ).toHaveLength(windowLimit);
  });
});
