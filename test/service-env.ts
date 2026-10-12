// Setup for every integration test: the service finds the stand-ins for the
// model, Parameter Store and Lambda (test/fakes.ts) through the environment
// it reads in production, so no call leaves the machine (ADR 9).
import { afterAll, vi } from "vitest";
import { fakes, modelKeyParameter, sortFunction } from "./fakes";

vi.stubEnv("SORT_FUNCTION", sortFunction);
vi.stubEnv("MODEL_KEY_PARAMETER", modelKeyParameter);
vi.stubEnv("MODEL_ENDPOINT", fakes.model.endpoint);
vi.stubEnv("SSM_ENDPOINT", fakes.parameters.endpoint);
vi.stubEnv("LAMBDA_ENDPOINT", fakes.lambda.endpoint);

afterAll(async () => {
  await fakes.close();
});
