// One helper to find, whose comment says why a test needs it.
import { describe, expect, it } from "vitest";
import { noon } from "./clock";
import { readRepoFile, repoFiles } from "./repo";

const helper = "test/clock.ts";

const others = (): string[] =>
  repoFiles().filter((path) => path.endsWith(".ts") && path !== helper);

// vi.setSystemTime fakes the date on its own when nothing else has.
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
