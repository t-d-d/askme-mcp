import { beforeAll, describe, expect, it } from "vitest";
import { codes } from "../service/src/errors";
import { reported } from "../test/lint";

const servicePath = "service/src/api.ts";

describe("fitness: one table of codes (error-contract.md)", () => {
  // The first type-aware lint of a file loads its project, which takes longer
  // than one test may.
  beforeAll(async () => {
    await reported("", servicePath);
  }, 60_000);

  it("holds six codes, each marked retry or do not retry", () => {
    expect(codes).toEqual({
      invalid_input: "do not retry",
      cap_reached: "do not retry",
      not_found: "do not retry",
      insufficient_scope: "do not retry",
      rate_limited: "retry",
      service_unavailable: "retry",
    });
  });

  it.each([
    [
      "a tool result marked as an error",
      "export const r = { content: [], isError: true };\n",
    ],
    [
      "a refusal body with a code and a class",
      'export const r = Response.json({ code: "oops", class: "retry", message: "x" });\n',
    ],
  ])("refuses %s built outside the errors module", async (_, code) => {
    for (const path of [servicePath, "service/src/tools.ts"]) {
      expect(await reported(code, path), path).toContain(
        "askme/refusal-from-table",
      );
    }
  });

  it("lets the errors module build them", async () => {
    expect(
      await reported(
        "export const r = { content: [], isError: true };\n",
        "service/src/errors.ts",
      ),
    ).not.toContain("askme/refusal-from-table");
  });
});
