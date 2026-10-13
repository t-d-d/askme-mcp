import { describe, expect, it } from "vitest";
import { callerOf } from "../service/src/identity";
import { fakeStore } from "./fake-store";

const { accountId: account } = callerOf({
  token: "test",
  clientId: "test",
  scopes: [],
  extra: { accountId: "user_1", requestId: "req-1" },
});
const now = new Date("2026-10-13T09:30:00.000Z");

describe("a fake store", () => {
  it("rejects a call to any method the test did not give it, naming the method", async () => {
    const store = fakeStore();
    const names = Object.keys(store).filter((name) => name !== "close");
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const method: unknown = Reflect.get(store, name);
      expect(typeof method, name).toBe("function");
      if (typeof method !== "function") continue;
      const answer: unknown = Reflect.apply(method, store, [account, now]);
      await expect(answer, name).rejects.toThrow(
        `The store's ${name} is not used here.`,
      );
    }
  });

  it("answers with the methods the test gives it, and rejects the rest", async () => {
    const store = fakeStore({
      countCall: () => Promise.resolve({ counted: true }),
      modelCapSpent: () => Promise.resolve(true),
    });
    await expect(store.countCall(account, "ask", now)).resolves.toEqual({
      counted: true,
    });
    await expect(store.modelCapSpent(account, now)).resolves.toBe(true);
    await expect(store.openAsks(account, now)).rejects.toThrow(
      "The store's openAsks is not used here.",
    );
  });

  it("closes without a call to anything", () => {
    expect(() => {
      fakeStore().close();
    }).not.toThrow();
  });
});
