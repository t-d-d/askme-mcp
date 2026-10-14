import { afterAll, describe, expect, inject, it } from "vitest";
import { z } from "zod";
import { handler } from "../service/src/handler";
import { fingerprint } from "../service/src/store/fingerprint";
import { keys } from "../service/src/store/keys";
import {
  askLifetimeDays,
  createStore,
  dedupeWindowMinutes,
} from "../service/src/store/store";
import { asksAnswer, pagePaths } from "../shared/page-api";
import { accountId, newAccount } from "../test/caller";
import { storedItems } from "../test/dynamodb";
import { useFakeIssuer } from "../test/identity";
import { invoke } from "../test/lambda";
import { connect, origin } from "../test/mcp";

const endpoint = inject("databaseEndpoint");
const tableName = inject("tableName");
const store = createStore({ tableName, endpoint });

const issuer = useFakeIssuer();
afterAll(() => {
  store.close();
});

const day = 86_400_000;

describe("fitness: expiry holds on read (hosting.md)", () => {
  // The local DynamoDB never deletes an expired item, and the real one
  // deletes it late, so the read has to leave it out itself.
  it("leaves out of the page's list an ask a month old, still in the table", async () => {
    const sub = newAccount();
    const owner = accountId(sub);
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

  it("makes a new ask when the identical one's dedupe record is past its expiry, though still in the table", async () => {
    const sub = newAccount();
    const owner = accountId(sub);
    const ask = {
      summary: "Approve the plan",
      area: "Home",
      spokenDetail: "The electrician needs a yes or no.",
    };
    const earlier = await store.postAsk(
      owner,
      ask,
      new Date(Date.now() - dedupeWindowMinutes * 60_000 - 1000),
    );
    if (earlier.kind !== "posted")
      throw new Error("The first ask was refused.");
    const record = keys.dedupe(owner, fingerprint(ask));
    const inTable = await storedItems(endpoint, tableName, owner);
    expect(inTable).toEqual(
      expect.arrayContaining([expect.objectContaining(record)]),
    );

    const agent = await connect(handler, {
      token: await issuer.token({ claims: { sub } }),
    });
    try {
      const result = await agent.callTool({
        name: "ask",
        arguments: {
          summary: ask.summary,
          area: ask.area,
          spoken_detail: ask.spokenDetail,
        },
      });
      const { id } = z
        .object({ id: z.string() })
        .parse(result.structuredContent);
      expect(id).not.toBe(earlier.id);
    } finally {
      await agent.close();
    }
    const asks = (await storedItems(endpoint, tableName, owner)).filter(
      (item) => typeof item.summary === "string",
    );
    expect(asks).toHaveLength(2);
  });
});
