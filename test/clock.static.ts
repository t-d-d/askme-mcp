// The integration tests stop the clock through test/clock.ts, so a test that
// counts against a rate window has one helper to find, and its comment says
// why the test needs it.
import { describe, expect, it } from "vitest";
import { noon } from "./clock";
import { readRepoFile, repoFiles } from "./repo";

const helper = "test/clock.ts";

// Every TypeScript file but the helper.
const others = (): string[] =>
  repoFiles().filter((path) => path.endsWith(".ts") && path !== helper);

describe("the integration tests stop the clock in one place", () => {
  it("fakes the date in test/clock.ts and no integration test", () => {
    expect(readRepoFile(helper)).toContain("useFakeTimers");
    expect(
      others().filter(
        (path) =>
          path.endsWith(".int.ts") &&
          readRepoFile(path).includes("useFakeTimers"),
      ),
    ).toEqual([]);
  });

  it("names the stopped moment in test/clock.ts and no other file", () => {
    expect(readRepoFile(helper)).toContain(noon.toISOString());
    expect(
      others().filter((path) =>
        readRepoFile(path).includes(noon.toISOString()),
      ),
    ).toEqual([]);
  });
});
