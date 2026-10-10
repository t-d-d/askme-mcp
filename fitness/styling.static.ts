import { describe, expect, it } from "vitest";
import { z } from "zod";
import { palette } from "../web/src/palette";
import { readRepoFile, repoFiles } from "../test/repo";

const tokensPath = "web/src/tokens.css";
const palettePath = "web/src/palette.ts";

const pageFiles = () =>
  repoFiles().filter(
    (path) =>
      path.startsWith("web/") &&
      /\.(?:css|html|tsx?)$/u.test(path) &&
      path !== tokensPath &&
      path !== palettePath,
  );

// The custom properties a stylesheet declares, by name.
function declared(css: string): Map<string, string> {
  return new Map(
    [...css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gu)].map((match) => [
      match[1] ?? "",
      (match[2] ?? "").trim(),
    ]),
  );
}

const colourLiteral =
  /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/iu;
const colourDeclaration =
  /(?:^|[;{\s])(?:color|background-color|background|border-(?:[a-z]+-)?color|outline-color|fill|stroke|caret-color|accent-color|text-decoration-color)\s*:\s*([^;}]+)/giu;
const colourKeyword =
  /^(?:var\(--[a-z0-9-]+\)|currentcolor|transparent|inherit|none)$/iu;

describe("fitness: values come from tokens (styling.md)", () => {
  it("finds the page's files", () => {
    expect(pageFiles()).toEqual(
      expect.arrayContaining(["web/index.html", "web/src/main.tsx"]),
    );
  });

  it.each(pageFiles())("holds no colour, font or font size in %s", (path) => {
    const text = readRepoFile(path);
    expect(text).not.toMatch(colourLiteral);
    expect(text).not.toMatch(/font-family\s*:(?!\s*var\()/iu);
    expect(text).not.toMatch(/font(?:-size)?\s*:[^;{}]*\d(?:px|pt)\b/iu);
    expect(text).not.toMatch(/\bfont(?:Family|Size)\s*:/u);
    const colours = [...text.matchAll(colourDeclaration)]
      .map((match) => (match[1] ?? "").trim())
      .filter((value) => !colourKeyword.test(value));
    expect(colours).toEqual([]);
  });

  it("uses only properties the tokens file declares", () => {
    const tokens = declared(readRepoFile(tokensPath));
    const hashtag = new Set(["--tag-strong", "--tag-tint", "--tag-ink"]);
    const unknown = pageFiles().flatMap((path) =>
      [...readRepoFile(path).matchAll(/var\((--[a-z0-9-]+)/gu)]
        .map((match) => match[1] ?? "")
        .filter((name) => !tokens.has(name) && !hashtag.has(name))
        .map((name) => `${name} in ${path}`),
    );
    expect(unknown).toEqual([]);
  });

  it("declares every neutral colour of docs/design.md, with its value", () => {
    const design = [
      ...readRepoFile("docs/design.md").matchAll(
        /^\| `(--[a-z0-9-]+)` \| `(#[0-9A-F]{6})` \|/gmu,
      ),
    ].map((match) => [match[1], match[2]?.toLowerCase()]);
    expect(design).toHaveLength(8);
    const tokens = declared(readRepoFile(tokensPath));
    expect(
      design.map(([name]) => [name, tokens.get(name ?? "")?.toLowerCase()]),
    ).toEqual(design);
  });

  it("holds the eight hashtag colours of docs/design.md in the palette module", () => {
    const design = [
      ...readRepoFile("docs/design.md").matchAll(
        /^\| ([a-z]+) \| `(#[0-9A-F]{6})` \| `(#[0-9A-F]{6})` \| `(#[0-9A-F]{6})` \|$/gmu,
      ),
    ].map(([, name, strong, tint, ink]) => ({ name, strong, tint, ink }));
    expect(design).toHaveLength(8);
    expect(
      Object.entries(palette).map(([name, colour]) => ({ name, ...colour })),
    ).toEqual(design);
  });
});

describe("fitness: no styling library (styling.md)", () => {
  const libraries = [
    /^tailwindcss$/u,
    /^@tailwindcss\//u,
    /^unocss$/u,
    /^@unocss\//u,
    /^windicss$/u,
    /^twind$/u,
    /^@twind\//u,
    /^daisyui$/u,
    /^bootstrap$/u,
    /^react-bootstrap$/u,
    /^bulma$/u,
    /^@mui\//u,
    /^@material-ui\//u,
    /^@chakra-ui\//u,
    /^antd$/u,
    /^@mantine\//u,
    /^@radix-ui\/themes$/u,
    /^primereact$/u,
    /^semantic-ui-react$/u,
    /^@fluentui\//u,
    /^styled-components$/u,
    /^@emotion\//u,
    /^@stitches\//u,
    /^goober$/u,
    /^jss$/u,
    /^react-jss$/u,
    /^styled-jsx$/u,
    /^@pandacss\//u,
    /^@vanilla-extract\//u,
    /^@linaria\//u,
    /^@compiled\//u,
    /^aphrodite$/u,
    /^theme-ui$/u,
  ];

  it("lists no utility framework, component kit or run-time CSS library", () => {
    const manifest = z
      .object({
        dependencies: z.record(z.string(), z.string()).optional(),
        devDependencies: z.record(z.string(), z.string()).optional(),
        optionalDependencies: z.record(z.string(), z.string()).optional(),
        peerDependencies: z.record(z.string(), z.string()).optional(),
      })
      .parse(JSON.parse(readRepoFile("package.json")));
    const names = Object.values(manifest).flatMap((group) =>
      Object.keys(group ?? {}),
    );
    expect(names).toContain("react");
    expect(
      names.filter((name) => libraries.some((library) => library.test(name))),
    ).toEqual([]);
  });
});
