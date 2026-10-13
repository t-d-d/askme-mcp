import { describe, expect, it } from "vitest";
import { fakeStore } from "./fake-store";
import { readRepoFile, repoFiles } from "./repo";

const helper = "test/fake-store.ts";

const methods = Object.keys(fakeStore());

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
