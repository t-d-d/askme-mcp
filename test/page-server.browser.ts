// The page the browser tier serves. Some of its tests see a bug only because
// StrictMode runs, and StrictMode runs only in React's development code. So
// the page must be built with that code whatever NODE_ENV the run starts
// with, or those tests would pass with the bug back in.
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { describe, expect, it } from "vitest";
import { builtFiles } from "./browser";

// React's development code carries this note, and its production code
// leaves it out.
const developmentOnly = "Download the React DevTools";

describe("the browser tier's page", () => {
  it("is built with React's development code", async () => {
    const scripts = (await builtFiles()).filter(
      (file) => extname(file) === ".js",
    );
    expect(scripts).not.toEqual([]);
    const carrying = [];
    for (const file of scripts) {
      if ((await readFile(file, "utf8")).includes(developmentOnly)) {
        carrying.push(file);
      }
    }
    expect(carrying).not.toEqual([]);
  });
});
