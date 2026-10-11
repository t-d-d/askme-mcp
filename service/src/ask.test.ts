import { describe, expect, it } from "vitest";
import { z } from "zod";
import { askTool } from "./ask";

// The input schema as an agent's client receives it.
const advertised = z
  .object({
    properties: z.record(z.string(), z.object({ description: z.string() })),
    required: z.array(z.string()),
  })
  .parse(z.toJSONSchema(askTool.input));

describe("the ask tool's description of its fields", () => {
  it("describes every field", () => {
    expect(Object.keys(advertised.properties).sort()).toEqual(
      [
        "action_link",
        "area",
        "replaces",
        "session_link",
        "spoken_detail",
        "summary",
      ].sort(),
    );
    for (const [field, { description }] of Object.entries(
      advertised.properties,
    )) {
      expect(description.length, field).toBeGreaterThan(20);
    }
  });

  it("requires the summary, the area and the spoken detail", () => {
    expect(advertised.required.sort()).toEqual(
      ["area", "spoken_detail", "summary"].sort(),
    );
  });

  it("asks for a spoken detail written to be heard, saying where the thing waits", () => {
    const { description } = advertised.properties.spoken_detail ?? {
      description: "",
    };
    expect(description).toContain("written to be heard");
    expect(description).toContain("No markdown, code, file paths or raw URLs");
    expect(description).toContain("say where");
    expect(description).toContain("a browser tab on one machine");
  });

  it("says the area is broad, and not shown", () => {
    const { description } = advertised.properties.area ?? { description: "" };
    expect(description).toContain("Broad, not the task in hand");
    expect(description).toContain("not shown");
  });

  it("says each link must be https", () => {
    for (const field of ["action_link", "session_link"]) {
      expect(advertised.properties[field]?.description, field).toContain(
        "https URL",
      );
    }
  });

  it("says an ask already closed in replaces posts this one as new", () => {
    expect(advertised.properties.replaces?.description).toContain(
      "An id askme does not know, or one whose ask is already closed, is ignored",
    );
  });
});
