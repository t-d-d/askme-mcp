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
});
