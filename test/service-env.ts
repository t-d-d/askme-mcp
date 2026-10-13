// Setup for every integration test: the service finds the stand-ins for the
// model, Parameter Store and the sort queue (test/fakes.ts) through the
// environment it reads in production, so no call leaves the machine (ADR 9).
import { afterAll, vi } from "vitest";
import { fakes, modelKeyParameter } from "./fakes";

vi.stubEnv("SORT_QUEUE", fakes.queue.url);
vi.stubEnv("MODEL_KEY_PARAMETER", modelKeyParameter);
vi.stubEnv("MODEL_ENDPOINT", fakes.model.endpoint);
vi.stubEnv("SSM_ENDPOINT", fakes.parameters.endpoint);
vi.stubEnv("SQS_ENDPOINT", fakes.queue.endpoint);

afterAll(async () => {
  await fakes.close();
});
