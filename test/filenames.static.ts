// A Mac reads some names as one that Linux keeps apart, so the gate on Linux
// checks for them. test/filenames.ts says which names those are.
import { describe, expect, it } from "vitest";
import { clashes } from "./filenames";
import { repoFiles } from "./repo";

describe("the repo's file names", () => {
  it("has no two files or folders whose names differ only in case or in how a letter is spelt", () => {
    expect(clashes(repoFiles())).toEqual([]);
  });
});
