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

// A call to either fakes the date. vi.setSystemTime does it on its own when
// nothing else has.
const fakesTheDate = /\b(?:useFakeTimers|setSystemTime)\(/u;

describe("the integration tests stop the clock in one place", () => {
  it("fakes the date in test/clock.ts and no integration test", () => {
    expect(readRepoFile(helper)).toMatch(fakesTheDate);
    expect(
      repoFiles().filter(
        (path) =>
          path.endsWith(".int.ts") && fakesTheDate.test(readRepoFile(path)),
      ),
    ).toEqual([]);
  });

  // To the second, so the moment is found however its milliseconds are
  // written, or left out.
  const moment = noon.toISOString().slice(0, "YYYY-MM-DDTHH:mm:ss".length);

  it("names the stopped moment in test/clock.ts and no other TypeScript file", () => {
    expect(readRepoFile(helper)).toContain(moment);
    expect(
      others().filter((path) => readRepoFile(path).includes(moment)),
    ).toEqual([]);
  });
});
