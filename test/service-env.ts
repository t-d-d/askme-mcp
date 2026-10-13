import { afterAll, afterEach, beforeEach, vi } from "vitest";
import { expectRepliesUsed, fakes, modelKeyParameter } from "./fakes";

vi.stubEnv("SORT_QUEUE", fakes.queue.url);
vi.stubEnv("MODEL_KEY_PARAMETER", modelKeyParameter);
vi.stubEnv("MODEL_ENDPOINT", fakes.model.endpoint);
vi.stubEnv("SSM_ENDPOINT", fakes.parameters.endpoint);
vi.stubEnv("SQS_ENDPOINT", fakes.queue.endpoint);

// Each test starts with no queued replies, recorded calls or waiting jobs.
beforeEach(() => {
  fakes.model.reset();
  fakes.queue.purge();
});

// A failed test may stop before it takes its replies, and its own error
// says why, so only a passing test is held to this.
afterEach(({ task }) => {
  if (task.result?.state === "fail") return;
  expectRepliesUsed(fakes.model);
});

afterAll(async () => {
  await fakes.close();
});
