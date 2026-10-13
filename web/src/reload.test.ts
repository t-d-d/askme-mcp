import { describe, expect, it } from "vitest";
import { answerRead, reloadOnce, type Marks } from "./reload";

const memory = (): Marks => {
  const held = new Map<string, string>();
  return {
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => {
      held.set(key, value);
    },
    removeItem: (key) => {
      held.delete(key);
    },
  };
};

const counting = () => {
  const reloads = { count: 0 };
  return {
    reloads,
    reload: () => {
      reloads.count += 1;
    },
  };
};

describe("reloading for an answer the page cannot read", () => {
  it("reloads the first time", () => {
    const { reloads, reload } = counting();
    reloadOnce(memory(), reload);
    expect(reloads.count).toBe(1);
  });

  it("does not reload a second time", () => {
    const marks = memory();
    const { reloads, reload } = counting();
    reloadOnce(marks, reload);
    reloadOnce(marks, reload);
    expect(reloads.count).toBe(1);
  });

  it("reloads again once an answer has been read", () => {
    const marks = memory();
    const { reloads, reload } = counting();
    reloadOnce(marks, reload);
    answerRead(marks);
    reloadOnce(marks, reload);
    expect(reloads.count).toBe(2);
  });

  it("does not reload when the mark cannot be kept", () => {
    const { reloads, reload } = counting();
    const refusing: Marks = {
      getItem: () => null,
      setItem: () => {
        throw new Error("Storage is full.");
      },
      removeItem: () => undefined,
    };
    reloadOnce(refusing, reload);
    expect(reloads.count).toBe(0);
  });

  it("does not reload when the mark cannot be read", () => {
    const { reloads, reload } = counting();
    const refusing: Marks = {
      getItem: () => {
        throw new Error("Storage is blocked.");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    reloadOnce(refusing, reload);
    expect(reloads.count).toBe(0);
  });
});
