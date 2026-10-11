import { describe, expect, it } from "vitest";
import { readEnv } from "./env";

describe("the environment", () => {
  it("reads the Clerk issuer, without a trailing slash", () => {
    expect(
      readEnv({ CLERK_ISSUER: "https://example.clerk.accounts.dev/" }),
    ).toEqual({ clerkIssuer: "https://example.clerk.accounts.dev" });
  });

  it("allows plain http only on loopback, for the fake issuer in tests", () => {
    expect(readEnv({ CLERK_ISSUER: "http://127.0.0.1:4100" })).toEqual({
      clerkIssuer: "http://127.0.0.1:4100",
    });
    expect(() =>
      readEnv({ CLERK_ISSUER: "http://example.clerk.accounts.dev" }),
    ).toThrow(/CLERK_ISSUER/u);
  });

  it("refuses a missing issuer, naming the variable", () => {
    expect(() => readEnv({})).toThrow(/CLERK_ISSUER/u);
  });

  it("refuses an issuer with a path, a query or a fragment", () => {
    for (const value of [
      "https://example.clerk.accounts.dev/oauth",
      "https://example.clerk.accounts.dev?x=1",
      "https://example.clerk.accounts.dev#x",
    ]) {
      expect(() => readEnv({ CLERK_ISSUER: value }), value).toThrow(
        /CLERK_ISSUER/u,
      );
    }
  });
});
