import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { handler } from "../service/src/handler";
import { callerOf } from "../service/src/identity";
import { askLifetimeDays, createStore } from "../service/src/store/store";
import { asksAnswer, pagePaths } from "../shared/page-api";
import { storedItems } from "../test/dynamodb";
import { startFakeIssuer, type FakeIssuer } from "../test/identity";
import { invoke } from "../test/lambda";
import { origin } from "../test/mcp";

const endpoint = inject("databaseEndpoint");
const tableName = inject("tableName");
const store = createStore({ tableName, endpoint });

let issuer: FakeIssuer;
beforeAll(async () => {
  issuer = await startFakeIssuer();
  vi.stubEnv("CLERK_ISSUER", issuer.issuer);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  store.close();
  await issuer.close();
});

const day = 86_400_000;

describe("fitness: expiry holds on read (hosting.md)", () => {
  // The local DynamoDB never deletes an expired item, and the real one
  // deletes it late, so the read has to leave it out itself.
  it("leaves out of the page's list an ask a month old, still in the table", async () => {
    const sub = `user_${randomUUID().slice(0, 8)}`;
    const owner = callerOf({
      token: "test",
      clientId: "test",
      scopes: [],
      extra: { accountId: sub, requestId: "r" },
    }).accountId;
    const fresh = { summary: "New", area: "Home", spokenDetail: "New." };
    const expired = { summary: "Old", area: "Home", spokenDetail: "Old." };
    await store.postAsk(
      owner,
      expired,
      new Date(Date.now() - askLifetimeDays * day - 1000),
    );
    await store.postAsk(owner, fresh, new Date());

    const inTable = await storedItems(endpoint, tableName, owner);
    expect(inTable.map((item) => item.summary).sort()).toEqual(
      expect.arrayContaining(["New", "Old"]),
    );

    const response = await invoke(
      handler,
      new Request(`${origin}${pagePaths.asks}`, {
        headers: {
          authorization: `Bearer ${await issuer.sessionToken({ claims: { sub } })}`,
        },
      }),
    );
    const { asks } = asksAnswer.parse(await response.json());
    expect(asks.map((ask) => ask.summary)).toEqual(["New"]);
  });
});
