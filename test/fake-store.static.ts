// A unit test builds a fake of the Store with test/fake-store.ts, so a change
// to the interface is made there, once, and in no test file (#292).
import { describe, expect, it } from "vitest";
import { fakeStore } from "./fake-store";
import { readRepoFile, repoFiles } from "./repo";

const helper = "test/fake-store.ts";

// The Store's methods, as the helper gives them.
const methods = Object.keys(fakeStore());

// Whether a file gives every method of the Store as a key of an object.
const fakesTheWholeStore = (text: string): boolean =>
  methods.every((name) => new RegExp(`\\b${name}:`, "u").test(text));

describe("a fake of the Store is written out in one place", () => {
  it("gives every method in test/fake-store.ts and no other TypeScript file", () => {
    expect(methods.length).toBeGreaterThan(1);
    expect(fakesTheWholeStore(readRepoFile(helper))).toBe(true);
    expect(
      repoFiles().filter(
        (path) =>
          path.endsWith(".ts") &&
          path !== helper &&
          fakesTheWholeStore(readRepoFile(path)),
      ),
    ).toEqual([]);
  });
});
