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
