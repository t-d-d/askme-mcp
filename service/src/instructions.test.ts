import { describe, expect, it } from "vitest";
import { askTool } from "./ask";
import { guidance, instructions } from "./instructions";
import { resolveTool } from "./resolve";

// The four things every agent is told (PRD, "MCP server"), each by the
// words that carry it.
const points = {
  "post whenever work stops to wait for the person":
    /Post an ask whenever your work stops to wait for the person/u,
  "a session may hold several open asks":
    /One session may hold several open asks/u,
  "resolve as soon as the wait is over":
    /Resolve each ask as soon as its wait is over, before doing anything else/u,
  "whatever askme answers, still ask in your own session":
    /Whatever askme answers, still ask your question in your own session/u,
};

describe("the server's instructions", () => {
  it.each(Object.entries(points))("say: %s", (_, words) => {
    expect(instructions).toMatch(words);
  });

  it("say how to replace an ask", () => {
    expect(instructions).toContain(guidance.replace);
  });
});

// Not every client passes the server's instructions on, so the tool
// descriptions repeat them.
describe("the ask tool's description", () => {
  it.each(Object.entries(points))("repeats: %s", (_, words) => {
    expect(askTool.description).toMatch(words);
  });

  it("names the tool that resolves an ask", () => {
    expect(askTool.description).toContain("the resolve tool");
  });

  it("says how to replace an ask, in the instructions' own words", () => {
    expect(askTool.description).toContain(guidance.replace);
  });
});

describe("the resolve tool's description", () => {
  it.each([
    "resolve as soon as the wait is over",
    "whatever askme answers, still ask in your own session",
  ] as const)("repeats: %s", (point) => {
    expect(resolveTool.description).toMatch(points[point]);
  });

  it("says that resolving an ask already closed succeeds", () => {
    expect(resolveTool.description).toContain(
      "Resolving an ask that is already closed succeeds",
    );
  });
});
