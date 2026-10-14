// The sort function's handler against a real DynamoDB, run locally, and the
// stand-ins for the model and Parameter Store (ADR 9).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { fakes, modelKeyParameter, testModelKey } from "../test/fakes";
import { captureLogs } from "../test/logs";
import { jobAccount } from "./src/identity";
import { handler as sorter, sortAttempts, sortDeliveries } from "./src/sorter";
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
const runFor = (
  accountId: string,
  askId: string,
  receives = 1,
  using: typeof sorter = sorter,
) =>
  using(
    {
      Records: [
        {
          messageId: randomUUID(),
          body: JSON.stringify({ accountId, askId }),
          attributes: { ApproximateReceiveCount: String(receives) },
        },
      ],
    },
    { awsRequestId: "sort-1" },
  );

// The function keeps its services for the life of its module, so this test
// loads the module afresh, whatever ran before it.
it("reads the model's key on its first sort, and keeps it for the runs after", async () => {
  vi.resetModules();
  const fresh = (await import("./src/sorter")).handler;
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
  const capture = captureLogs();
  try {
    for (const askId of askIds) {
      fakes.model.reply({
        json: { hashtags: ["work"], level: "normal", reason: "Routine." },
      });
      expect(await runFor(sub, askId, 1, fresh)).toEqual({
        batchItemFailures: [],
      });
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
  expect(fakes.model.calls).toEqual(askIds.map(() => keyed));
  expect(fakes.parameters.asked).toEqual([modelKeyParameter]);
});

// OpenRouter answers 401 for a refused key and 402 for spent credit, which
// alert. A 403 can come from moderation of a hostile ask, so it must not.
// The failed sort itself stays at warn (ADR 22). A refusal of askme's own
// gets no second try (ADR 28).
describe("a sort the model refuses on the last delivery", () => {
  it.each([
    [401, "error"],
    [402, "error"],
    [403, "warn"],
    [429, "warn"],
    [500, "warn"],
    [503, "warn"],
  ])("logs a %i at %s", async (status, level) => {
    const sub = `user_${randomUUID().slice(0, 8)}`;
    const account = jobAccount(sub);
    await store.saveRules(
      account,
      { text: "#work first.", hashtags: ["work"] },
      new Date(),
    );
    const posting = await store.postAsk(
      account,
      { summary: "First", area: "Work", spokenDetail: "First." },
      new Date(),
    );
    if (posting.kind !== "posted") throw new Error("Not posted.");
    const tries = level === "error" ? 1 : sortAttempts;
    fakes.model.reply(...Array.from({ length: tries }, () => ({ status })));
    const capture = captureLogs();
    try {
      expect(await runFor(sub, posting.id, sortDeliveries)).toEqual({
        batchItemFailures: [],
      });
    } finally {
      capture.restore();
    }
    const failed = {
      method: "warn",
      args: [
        expect.objectContaining({
          event: "sort-failed",
          askId: posting.id,
          errorClass: `status-${String(status)}`,
        }),
      ],
    };
    const ours = {
      method: "error",
      args: [
        expect.objectContaining({
          event: "request-failed",
          errorClass: `status-${String(status)}`,
        }),
      ],
    };
    expect(capture.lines).toEqual(
      level === "error" ? [ours, failed] : [failed],
    );
  });
});
