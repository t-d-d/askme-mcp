// The live tier reads the deployed site's addresses in test/live.ts, so a
// change to a variable or its message is made once.
import { describe, expect, it } from "vitest";
import { liveTierFiles } from "./live-tier";
import { deployPath, readRepoFile, readWorkflow } from "./repo";

const helper = "test/live.ts";

// The variables the deploy workflow gives the live tier.
const given = (): string[] =>
  Object.keys(
    readWorkflow(deployPath).jobs.live?.steps?.find(
      (step) => step.run === "npm run test:live",
    )?.env ?? {},
  );

describe("the live tier reads its addresses in one place", () => {
  it("finds the variables the deploy gives the live tier", () => {
    expect(given()).toEqual(
      expect.arrayContaining(["ASKME_URL", "ASKME_MCP_URL", "CLERK_ISSUER"]),
    );
  });

  // Any mention of the process counts, so env destructured from it, or
  // imported from node:process, is found as well as process.env.
  it("reads the environment in test/live.ts and no other live file", () => {
    expect(
      liveTierFiles().filter((path) => /\bprocess\b/u.test(readRepoFile(path))),
    ).toEqual([helper]);
  });

  it("names each variable the deploy gives it in test/live.ts alone", () => {
    for (const name of given()) {
      expect(
        liveTierFiles().filter((path) => readRepoFile(path).includes(name)),
        name,
      ).toEqual([helper]);
    }
  });
});
