import { describe, expect, it } from "vitest";
import { listenLength } from "./speech";

const words = (count: number) =>
  Array.from({ length: count }, () => "word").join(" ");

describe("how long the spoken text takes to hear", () => {
  it.each([
    [1, "About 10 seconds"],
    [25, "About 10 seconds"],
    [57, "About 20 seconds"],
    [100, "About 40 seconds"],
    [140, "About a minute"],
    [150, "About a minute"],
    [300, "About 2 minutes"],
  ])("is said in round numbers: %i words take %s", (count, length) => {
    expect(listenLength(words(count))).toBe(length);
  });

  it("counts words however they are spaced", () => {
    expect(listenLength(`  ${words(100).replaceAll(" ", " \n\t ")}  `)).toBe(
      "About 40 seconds",
    );
  });
});
