// The sort function's handler against a real DynamoDB, run locally, and the
// stand-ins for the model and Parameter Store (ADR 9).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, inject, it, vi } from "vitest";
import { fakes } from "../test/fakes";
import { jobAccount } from "./src/identity";
import { handler as sorter } from "./src/sorter";
import { createStore } from "./src/store/store";

const store = createStore({
  tableName: inject("tableName"),
  endpoint: inject("databaseEndpoint"),
});

// The function reads the whole environment, Clerk's issuer included, though
// it never calls Clerk.
beforeAll(() => {
  vi.stubEnv("CLERK_ISSUER", "http://127.0.0.1");
});
afterAll(() => {
  vi.unstubAllEnvs();
  store.close();
});

// One run of the function, with one job, as the queue's trigger hands it.
const runFor = (accountId: string, askId: string) =>
  sorter(
    {
      Records: [
        {
          messageId: randomUUID(),
          body: JSON.stringify({ accountId, askId }),
          attributes: { ApproximateReceiveCount: "1" },
        },
      ],
    },
    { awsRequestId: "sort-1" },
  );

it("reads the model's key on its first sort, and keeps it for the runs after", async () => {
  const sub = `user_${randomUUID().slice(0, 8)}`;
  const account = jobAccount(sub);
  await store.saveRules(
    account,
    { text: "#work first.", hashtags: ["work"] },
    new Date(),
  );
  const askIds: string[] = [];
  for (const summary of ["First", "Second"]) {
    const posting = await store.postAsk(
      account,
      { summary, area: "Work", spokenDetail: `${summary}.` },
      new Date(),
    );
    if (posting.kind !== "posted") throw new Error("Not posted.");
    askIds.push(posting.id);
  }
  const calls = fakes.model.calls.length;
  const reads = fakes.parameters.asked.length;
  for (const askId of askIds) {
    fakes.model.reply({
      json: { hashtags: ["work"], level: "normal", reason: "Routine." },
    });
    expect(await runFor(sub, askId)).toEqual({ batchItemFailures: [] });
  }
  expect(fakes.model.calls).toHaveLength(calls + askIds.length);
  expect(fakes.parameters.asked.slice(reads)).toHaveLength(1);
});
