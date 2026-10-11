import { describe, expect, it } from "vitest";
import { z } from "zod";
import { resolveTool } from "./resolve";

// The input schema as an agent's client receives it.
const advertised = z
  .object({
    properties: z.record(z.string(), z.object({ description: z.string() })),
    required: z.array(z.string()),
  })
  .parse(z.toJSONSchema(resolveTool.input));

describe("the resolve tool's description of its fields", () => {
  it("takes one field, the id, and requires it", () => {
    expect(Object.keys(advertised.properties)).toEqual(["id"]);
    expect(advertised.required).toEqual(["id"]);
  });

  it("says the id is the one ask gave back", () => {
    expect(advertised.properties.id?.description).toMatch(
      /the id the ask tool gave back/iu,
    );
  });
});
