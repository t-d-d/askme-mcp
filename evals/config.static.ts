// How `npm run eval` reports. Running the eval is not in the gate
// (test-tiers.md), but its config is a file in the repo.
import { describe, expect, it } from "vitest";
import config from "./vitest.config";

describe("the eval's config", () => {
  it("shows the scores to an agent as to a person", () => {
    expect(config).toMatchObject({ test: { silent: false } });
  });
});
