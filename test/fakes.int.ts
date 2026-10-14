import { describe, expect, it } from "vitest";
import { expectRepliesUsed, fakes } from "./fakes";

const callModel = async (): Promise<number> =>
  (
    await fetch(`${fakes.model.endpoint}/chat/completions`, {
      method: "POST",
      body: "{}",
    })
  ).status;

// The tests run in order, and the second sees what the first left.
describe("the fake model between tests", () => {
  it("records a call and takes a queued reply", async () => {
    fakes.model.reply({ status: 429 });
    expect(await callModel()).toBe(429);
    expect(fakes.model.calls).toHaveLength(1);
  });

  it("starts the next test with no recorded calls", () => {
    expect(fakes.model.calls).toEqual([]);
  });
});

describe("resetting the fake model", () => {
  it("drops the queued replies and the recorded calls", async () => {
    fakes.model.reply({ status: 429 }, { status: 402 });
    expect(await callModel()).toBe(429);
    fakes.model.reset();
    expect(fakes.model.calls).toEqual([]);
    expect(fakes.model.unused()).toBe(0);
    expect(await callModel()).toBe(503);
  });
});

describe("a queued reply left unused", () => {
  it("fails the check, naming how many are left", () => {
    fakes.model.reply({ status: 429 }, { status: 402 });
    expect(() => {
      expectRepliesUsed(fakes.model);
    }).toThrow("2 queued model replies were left unused");
    fakes.model.reset();
  });

  it("passes the check when every reply was used", async () => {
    fakes.model.reply({ status: 429 });
    expect(await callModel()).toBe(429);
    expect(() => {
      expectRepliesUsed(fakes.model);
    }).not.toThrow();
  });
});

const sendBatch = async (deduplicationId: string): Promise<number> =>
  (
    await fetch(fakes.queue.endpoint, {
      method: "POST",
      headers: {
        "x-amz-target": "AmazonSQS.SendMessageBatch",
        "content-type": "application/x-amz-json-1.0",
      },
      body: JSON.stringify({
        QueueUrl: fakes.queue.url,
        Entries: [
          {
            Id: "1",
            MessageBody: "{}",
            MessageGroupId: "group",
            MessageDeduplicationId: deduplicationId,
          },
        ],
      }),
    })
  ).status;

const askParameter = async (): Promise<void> => {
  await fetch(fakes.parameters.endpoint, {
    method: "POST",
    headers: { "x-amz-target": "AmazonSSM.GetParameter" },
    body: JSON.stringify({ Name: "/askme/other" }),
  });
};

// Sends a message and asks for a parameter, then sets every switch.
const changeEveryFake = async (deduplicationId: string): Promise<void> => {
  expect(await sendBatch(deduplicationId)).toBe(200);
  await askParameter();
  fakes.queue.loseAnswers(1);
  fakes.queue.failing = true;
  fakes.queue.hanging = true;
  fakes.queue.refusing = true;
  fakes.parameters.hanging = true;
};

const expectEveryFakeAsItBegan = async (
  deduplicationId: string,
): Promise<void> => {
  expect(fakes.model.unused()).toBe(0);
  expect(fakes.queue.failing).toBe(false);
  expect(fakes.queue.hanging).toBe(false);
  expect(fakes.queue.refusing).toBe(false);
  expect(fakes.queue.sent).toEqual([]);
  expect(fakes.queue.calls).toEqual([]);
  expect(fakes.queue.waiting()).toBe(0);
  expect(fakes.parameters.hanging).toBe(false);
  expect(fakes.parameters.asked).toEqual([]);
  // No lost answer is left, and the earlier message is not a repeat.
  expect(await sendBatch(deduplicationId)).toBe(200);
  expect(fakes.queue.sent.map(({ taken }) => taken)).toEqual([true]);
};

// The tests run in order, and the second sees what the first left.
describe("every fake between tests", () => {
  it("leaves every fake changed", async () => {
    await changeEveryFake("between-tests");
    expect(fakes.queue.waiting()).toBe(1);
  });

  it("starts the next test with every fake as it began", async () => {
    await expectEveryFakeAsItBegan("between-tests");
  });
});

describe("resetting every fake", () => {
  it("returns each fake to its starting state", async () => {
    fakes.model.reply({ status: 429 });
    await changeEveryFake("reset");
    fakes.reset();
    await expectEveryFakeAsItBegan("reset");
  });
});
