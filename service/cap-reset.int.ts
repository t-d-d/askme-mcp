// The poll at the moment the daily cap on model calls resets, through the
// page's API on the local DynamoDB. The reset time is given while it is
// still ahead, and not at the moment itself, when the cap has reset.
import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  inject,
  it,
  vi,
} from "vitest";
import { z } from "zod";
import { pagePaths } from "../shared/page-api";
import { stopClockAt } from "../test/clock";
import { startFakeIssuer, type FakeIssuer } from "../test/identity";
import { invoke } from "../test/lambda";
import { origin } from "../test/mcp";
import { handler } from "./src/handler";
import { callerOf } from "./src/identity";
import { createStore } from "./src/store/store";

let issuer: FakeIssuer;
beforeAll(async () => {
  issuer = await startFakeIssuer();
  vi.stubEnv("CLERK_ISSUER", issuer.issuer);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await issuer.close();
});
afterEach(() => {
  vi.useRealTimers();
});

const store = createStore({
  tableName: inject("tableName"),
  endpoint: inject("databaseEndpoint"),
});
afterAll(() => {
  store.close();
});

// A fresh account for each test: the table is shared by every test file.
const newAccount = () => `user_${randomUUID().slice(0, 8)}`;

const ownerOf = (account: string) =>
  callerOf({
    token: "test",
    clientId: "test",
    scopes: [],
    extra: { accountId: account, requestId: "r" },
  }).accountId;

// When the poll says the cap resets, polled at a stopped moment.
async function capResetsAt(account: string, at: Date) {
  stopClockAt(at);
  const token = await issuer.sessionToken({ claims: { sub: account } });
  const response = await invoke(
    handler,
    new Request(`${origin}${pagePaths.asks}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  return z
    .object({ modelCapResetsAt: z.string().optional() })
    .parse(await response.json()).modelCapResetsAt;
}

describe("the list at the moment the cap on model calls resets", () => {
  it("carries the reset time a moment before it", async () => {
    const account = newAccount();
    const resets = new Date(Date.now() + 60 * 60_000);
    await store.recordModelCapReset(ownerOf(account), resets);
    expect(await capResetsAt(account, new Date(resets.getTime() - 1))).toBe(
      resets.toISOString(),
    );
  });

  it("carries none at the moment itself, as the cap has reset", async () => {
    const account = newAccount();
    const resets = new Date(Date.now() + 60 * 60_000);
    await store.recordModelCapReset(ownerOf(account), resets);
    expect(await capResetsAt(account, resets)).toBeUndefined();
  });
});
