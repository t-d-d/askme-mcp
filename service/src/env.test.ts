import { describe, expect, it } from "vitest";
import { readEnv } from "./env";

const issuer = "https://example.clerk.accounts.dev";
const table = { TABLE_NAME: "askme-prod-Table-ABC123" };

describe("the environment", () => {
  it("reads the Clerk issuer, without a trailing slash", () => {
    expect(readEnv({ CLERK_ISSUER: `${issuer}/`, ...table })).toEqual({
      clerkIssuer: issuer,
      tableName: table.TABLE_NAME,
    });
  });

  it("allows plain http only on loopback, for the fake issuer in tests", () => {
    expect(
      readEnv({ CLERK_ISSUER: "http://127.0.0.1:4100", ...table }).clerkIssuer,
    ).toBe("http://127.0.0.1:4100");
    expect(() =>
      readEnv({ CLERK_ISSUER: "http://example.clerk.accounts.dev", ...table }),
    ).toThrow(/CLERK_ISSUER/u);
  });

  it("refuses a missing issuer, naming the variable", () => {
    expect(() => readEnv({ ...table })).toThrow(/CLERK_ISSUER/u);
  });

  it("refuses an issuer with a path, a query or a fragment", () => {
    for (const value of [
      "https://example.clerk.accounts.dev/oauth",
      "https://example.clerk.accounts.dev?x=1",
      "https://example.clerk.accounts.dev#x",
    ]) {
      expect(() => readEnv({ CLERK_ISSUER: value, ...table }), value).toThrow(
        /CLERK_ISSUER/u,
      );
    }
  });

  it("refuses a missing table name, naming the variable", () => {
    expect(() => readEnv({ CLERK_ISSUER: issuer })).toThrow(/TABLE_NAME/u);
    expect(() => readEnv({ CLERK_ISSUER: issuer, TABLE_NAME: "" })).toThrow(
      /TABLE_NAME/u,
    );
  });

  it("reads a database endpoint on loopback, for the local DynamoDB in tests", () => {
    expect(
      readEnv({
        CLERK_ISSUER: issuer,
        ...table,
        DYNAMODB_ENDPOINT: "http://127.0.0.1:8000",
      }).databaseEndpoint,
    ).toBe("http://127.0.0.1:8000");
  });

  it("refuses a database endpoint anywhere but loopback", () => {
    for (const value of [
      "https://dynamodb.us-east-1.amazonaws.com",
      "http://10.0.0.1:8000",
      "not a url",
    ]) {
      expect(
        () =>
          readEnv({ CLERK_ISSUER: issuer, ...table, DYNAMODB_ENDPOINT: value }),
        value,
      ).toThrow(/DYNAMODB_ENDPOINT/u);
    }
  });
});
