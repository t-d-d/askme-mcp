// The sort function's handler against a real DynamoDB, run locally, and the
// stand-ins for the model and Parameter Store (ADR 9).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, inject, it, vi } from "vitest";
import { fakes, modelKeyParameter, testModelKey } from "../test/fakes";
import { captureLogs } from "../test/logs";
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

// The function keeps its services for the life of this file's module, so
// this test must make the file's first run of it.
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
  const capture = captureLogs();
  try {
    for (const askId of askIds) {
      fakes.model.reply({
        json: { hashtags: ["work"], level: "normal", reason: "Routine." },
      });
      expect(await runFor(sub, askId)).toEqual({ batchItemFailures: [] });
    }
  } finally {
    capture.restore();
  }
  // Each run stored its sort, and each call carried the key it kept.
  expect(capture.lines).toEqual(
    askIds.map((askId) => ({
      method: "info",
      args: [expect.objectContaining({ event: "ask-sorted", askId })],
    })),
  );
  const keyed: unknown = expect.objectContaining({
    authorization: `Bearer ${testModelKey}`,
  });
  expect(fakes.model.calls.slice(calls)).toEqual(askIds.map(() => keyed));
  expect(fakes.parameters.asked.slice(reads)).toEqual([modelKeyParameter]);
});
