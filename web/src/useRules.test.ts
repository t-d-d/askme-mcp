import { describe, expect, it } from "vitest";
import { rulesToSave } from "./useRules";

describe("the time zone a save sends", () => {
  it("is this browser's, when it is a zone's name askme takes", () => {
    expect(rulesToSave("#work", "Europe/London")).toEqual({
      text: "#work",
      timeZone: "Europe/London",
    });
  });

  it("is left out when the browser gives a name askme would refuse, so the save still goes", () => {
    expect(rulesToSave("#work", "GMT+05:30")).toEqual({ text: "#work" });
    expect(rulesToSave("#work", undefined)).toEqual({ text: "#work" });
  });
});
