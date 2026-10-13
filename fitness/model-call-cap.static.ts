import { describe, expect, it } from "vitest";
import { readRepoFile, repoFiles } from "../test/repo";

const countingModule = "service/src/model.ts";

// A test may build any client, and the eval is outside the cap.
const serviceCode = () =>
  repoFiles().filter(
    (path) =>
      path.startsWith("service/") &&
      /\.tsx?$/u.test(path) &&
      !/\.(?:static|test|int|browser|live|conformance)\.ts$/u.test(path),
  );

// createModel builds a client that counts nothing.
const buildsClient = (text: string) =>
  /\bcreateModel\b|chat\/completions|openrouter\.ai/u.test(text);

describe("fitness: one module builds the model client (model-call-cap.md)", () => {
  it("builds a model client nowhere in the service but the counting module", () => {
    const building = serviceCode().filter(
      (path) => path !== countingModule && buildsClient(readRepoFile(path)),
    );
    expect(building).toEqual([]);
  });

  it("finds the client the counting module builds", () => {
    expect(buildsClient(readRepoFile(countingModule))).toBe(true);
  });

  it.each([
    'import { createModel } from "./model";\n',
    'import { createModel as client } from "./model";\n',
    'await fetch(`${endpoint}/chat/completions`, { method: "POST" });\n',
    'const endpoint = "https://openrouter.ai/api/v1";\n',
  ])("finds a client built another way: %s", (code) => {
    expect(buildsClient(code)).toBe(true);
  });

  it("finds the service's code and leaves its tests and the eval out", () => {
    const code = serviceCode();
    expect(code).toContain("service/src/handler.ts");
    expect(code).toContain("service/src/sorter.ts");
    expect(code).not.toContain("service/src/model.test.ts");
    expect(code).not.toContain("service/api.int.ts");
    expect(code.some((path) => path.startsWith("evals/"))).toBe(false);
  });
});
