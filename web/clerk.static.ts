import { describe, expect, it } from "vitest";
import { deployPath, readRepoFile, readWorkflow } from "../test/repo";

describe("sign-in on the page", () => {
  it("builds the deployed page with Clerk's publishable key from the repo variables", () => {
    const build = readWorkflow(deployPath).jobs.deploy?.steps?.find(
      (step) => step.run === "npm run build",
    );
    expect(build?.env).toEqual({
      VITE_CLERK_PUBLISHABLE_KEY: "${{ vars.CLERK_PUBLISHABLE_KEY }}",
    });
  });

  it("builds the page in the gate with the stand-in for Clerk", () => {
    expect(readRepoFile("web/src/main.tsx")).toContain(
      'import { ClerkAuth } from "./clerk";',
    );
    expect(readRepoFile("test/page-server.ts")).toMatch(
      /find: \/\^\\\.\\\/clerk\$\/u, replacement: fakeClerk/u,
    );
  });
});
