import { describe, expect, it } from "vitest";
import { callerOf, type AccountId } from "./identity";
import { createSortRequests, jobMessage, sortJobSchema } from "./jobs";

const accountId = (sub: string): AccountId =>
  callerOf({
    token: "test",
    clientId: "test",
    scopes: [],
    extra: { accountId: sub, requestId: "r" },
  }).accountId;

const owner = accountId("user_owner");
const askId = "AAAAAAAAAAAAAAAAAAAAAAAA";
const savedAt = new Date("2026-10-12T09:30:00.000Z");

// What SQS takes in a group or deduplication id.
const sqsId = /^[\w!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~-]{1,128}$/u;

describe("a sort job's message", () => {
  it("names the account and the ask, and nothing else", () => {
    const { text } = jobMessage(owner, askId, savedAt);
    expect(sortJobSchema.parse(JSON.parse(text))).toEqual({
      accountId: owner,
      askId,
    });
  });

  it("puts each ask in its own group", () => {
    expect(jobMessage(owner, askId, savedAt).groupId).toBe(askId);
    expect(jobMessage(owner, "BBBB", savedAt).groupId).toBe("BBBB");
  });

  it("gives a repeat of one send the same deduplication id", () => {
    expect(jobMessage(owner, askId, savedAt).deduplicationId).toBe(
      jobMessage(owner, askId, new Date(savedAt.getTime())).deduplicationId,
    );
  });

  it("gives sends from a different post or save, ask or account a different deduplication id", () => {
    const first = jobMessage(owner, askId, savedAt).deduplicationId;
    for (const other of [
      jobMessage(owner, askId, new Date(savedAt.getTime() + 1)),
      jobMessage(owner, "BBBBBBBBBBBBBBBBBBBBBBBB", savedAt),
      jobMessage(accountId("user_other"), askId, savedAt),
    ]) {
      expect(other.deduplicationId).not.toBe(first);
    }
  });

  it("keeps both ids within what SQS takes, for the longest account and ask", () => {
    const { groupId, deduplicationId } = jobMessage(
      accountId("u".repeat(64)),
      "a".repeat(64),
      savedAt,
    );
    expect(groupId).toMatch(sqsId);
    expect(deduplicationId).toMatch(sqsId);
  });
});

describe("queueing sorts", () => {
  it("gives an ask it cannot make a job of as not taken, and does not throw", async () => {
    // The ask's id fails the job's schema before any call is made, so no
    // queue is reached.
    const sorts = createSortRequests({
      queueUrl: "http://127.0.0.1:9/000000000000/askme-sort.fifo",
    });
    expect(await sorts.queue(owner, ["not an id!"], savedAt)).toEqual([
      { askId: "not an id!", errorClass: "ZodError" },
    ]);
  });
});
