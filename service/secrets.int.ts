import { describe, expect, it } from "vitest";
import { fakes, modelKeyParameter, testModelKey } from "../test/fakes";
import { createKeyReader, keyReadTimeoutMs } from "./src/secrets";

describe("reading the model's key", () => {
  it(`gives up on a Parameter Store that does not answer within ${String(keyReadTimeoutMs)}ms, and reads again next time`, async () => {
    const read = createKeyReader({
      parameter: modelKeyParameter,
      endpoint: fakes.parameters.endpoint,
    });
    fakes.parameters.hanging = true;
    try {
      const started = Date.now();
      await expect(read()).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(keyReadTimeoutMs + 500);
    } finally {
      fakes.parameters.hanging = false;
    }
    expect(await read()).toBe(testModelKey);
  });
});
