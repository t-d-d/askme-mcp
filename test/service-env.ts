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

afterEach(() => {
  expectRepliesUsed(fakes.model);
});

afterAll(async () => {
  await fakes.close();
});
