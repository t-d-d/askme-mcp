import { describe, expect, it } from "vitest";
import { readEnv } from "./env";

const issuer = "https://example.clerk.accounts.dev";
const table = {
  TABLE_NAME: "askme-prod-Table-ABC123",
  SORT_QUEUE:
    "https://sqs.us-east-1.amazonaws.com/123456789012/askme-sort.fifo",
  MODEL_KEY_PARAMETER: "/askme/openrouter/api-key",
};

describe("the environment", () => {
  it("reads the Clerk issuer, without a trailing slash", () => {
    expect(readEnv({ CLERK_ISSUER: `${issuer}/`, ...table })).toEqual({
      clerkIssuer: issuer,
      tableName: table.TABLE_NAME,
      sortQueue: table.SORT_QUEUE,
      modelKeyParameter: table.MODEL_KEY_PARAMETER,
      modelEndpoint: "https://openrouter.ai/api/v1",
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
    const noTable: Record<string, string> = { CLERK_ISSUER: issuer, ...table };
    delete noTable.TABLE_NAME;
    expect(() => readEnv(noTable)).toThrow(/TABLE_NAME/u);
    expect(() =>
      readEnv({ CLERK_ISSUER: issuer, ...table, TABLE_NAME: "" }),
    ).toThrow(/TABLE_NAME/u);
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

  it("refuses a missing sort queue or key parameter, naming the variable", () => {
    for (const name of ["SORT_QUEUE", "MODEL_KEY_PARAMETER"] as const) {
      const source: Record<string, string> = { CLERK_ISSUER: issuer, ...table };
      source[name] = "";
      expect(() => readEnv(source), name).toThrow(new RegExp(name, "u"));
    }
  });

  it("reads the sort queue's address on loopback over plain http, for the fake queue in tests, and only there", () => {
    expect(
      readEnv({
        CLERK_ISSUER: issuer,
        ...table,
        SORT_QUEUE: "http://127.0.0.1:4500/000000000000/askme-sort.fifo",
      }).sortQueue,
    ).toBe("http://127.0.0.1:4500/000000000000/askme-sort.fifo");
    for (const value of [
      "http://sqs.us-east-1.amazonaws.com/123456789012/askme-sort.fifo",
      "askme-sort.fifo",
    ]) {
      expect(
        () => readEnv({ CLERK_ISSUER: issuer, ...table, SORT_QUEUE: value }),
        value,
      ).toThrow(/SORT_QUEUE/u);
    }
  });

  it("reads the model, parameter and queue endpoints on loopback, for the fakes in tests", () => {
    expect(
      readEnv({
        CLERK_ISSUER: issuer,
        ...table,
        MODEL_ENDPOINT: "http://127.0.0.1:4200/api/v1",
        SSM_ENDPOINT: "http://127.0.0.1:4300",
        SQS_ENDPOINT: "http://localhost:4400",
      }),
    ).toMatchObject({
      modelEndpoint: "http://127.0.0.1:4200/api/v1",
      ssmEndpoint: "http://127.0.0.1:4300",
      queueEndpoint: "http://localhost:4400",
    });
  });

  it("refuses a model, parameter or queue endpoint anywhere but loopback", () => {
    for (const name of [
      "MODEL_ENDPOINT",
      "SSM_ENDPOINT",
      "SQS_ENDPOINT",
    ] as const) {
      for (const value of ["https://openrouter.ai/api/v1", "not a url"]) {
        expect(
          () => readEnv({ CLERK_ISSUER: issuer, ...table, [name]: value }),
          `${name}=${value}`,
        ).toThrow(new RegExp(name, "u"));
      }
    }
  });
});
