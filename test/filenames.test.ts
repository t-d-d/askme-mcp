import { describe, expect, it } from "vitest";
import { clashes } from "./filenames";

describe("the file-name check", () => {
  it("finds two files or folders whose names differ only in case", () => {
    expect(clashes(["web/src/Asks.tsx", "web/src/asks.ts"])).toEqual([
      ["web/src/Asks", "web/src/asks"],
    ]);
    expect(clashes(["Docs/one.md", "docs/two.md"])).toEqual([["Docs", "docs"]]);
  });

  it("finds two names that spell a letter in two ways", () => {
    expect(clashes(["docs/caf\u00e9.md", "docs/cafe\u0301.md"])).toEqual([
      ["docs/caf\\u{e9}", "docs/cafe\\u{301}"],
    ]);
  });

  it("finds two names that differ only in letters Unicode's case folding joins", () => {
    for (const pair of [
      ["docs/οδος.md", "docs/οδοσ.md"],
      ["docs/ſtate.md", "docs/state.md"],
      ["docs/ϐeta.md", "docs/βeta.md"],
      ["docs/Straße.md", "docs/Strasse.md"],
      ["docs/Straße.md", "docs/STRAẞE.md"],
    ]) {
      expect(clashes(pair), pair.join(" and ")).toHaveLength(1);
    }
  });

  it("keeps the dotless ı apart from i, as Unicode's case folding does outside Turkish", () => {
    expect(clashes(["docs/k\u0131ta.md", "docs/kita.md"])).toEqual([]);
  });

  it("finds a declaration file beside a file whose name differs only in case", () => {
    expect(clashes(["web/src/Vite-env.ts", "web/src/vite-env.d.ts"])).toEqual([
      ["web/src/Vite-env", "web/src/vite-env"],
    ]);
  });

  it("finds two files whose names differ only in the case of the extension", () => {
    expect(clashes(["docs/a.MD", "docs/a.md"])).toEqual([
      ["docs/a.MD", "docs/a.md"],
    ]);
  });

  it("finds a folder whose name has a dot beside a file of that name in another case", () => {
    expect(clashes(["docs/a.md/notes.md", "docs/A.md"])).toEqual([
      ["docs/a.md", "docs/A.md"],
    ]);
  });

  it("lists two files once when their names clash with and without their extensions", () => {
    expect(clashes(["docs/A.md", "docs/a.md"])).toEqual([["docs/A", "docs/a"]]);
  });

  it("lists two files by their whole names when folders or files of their names without extensions also clash", () => {
    expect(
      clashes(["docs/A.md", "docs/a.md", "docs/A/x.md", "docs/a/y.md"]),
    ).toEqual([
      ["docs/A.md", "docs/a.md"],
      ["docs/A", "docs/a"],
    ]);
    expect(clashes(["docs/A.md", "docs/a.md", "docs/a"])).toEqual([
      ["docs/A.md", "docs/a.md"],
      ["docs/A", "docs/a"],
    ]);
  });

  it("lists two folders whose names have a dot, though files beside them clash without their extensions", () => {
    expect(
      clashes(["docs/v1.2/a.md", "docs/V1.2/b.md", "docs/v1.ts", "docs/V1.ts"]),
    ).toEqual([
      ["docs/v1.2", "docs/V1.2"],
      ["docs/v1", "docs/V1"],
    ]);
  });
});
