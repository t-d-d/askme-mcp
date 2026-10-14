import { describe, expect, it } from "vitest";
import { answerRead, reloadOnce, storedMarks, type Marks } from "./reload";

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

const asks = "/api/asks";
const rules = "/api/rules";

// Each page load has its own id.
const first = "first-load";
const second = "second-load";

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
    reloadOnce(memory(), reload, asks);
    expect(reloads.count).toBe(1);
  });

  it("does not reload a second time", () => {
    const marks = memory();
    const { reloads, reload } = counting();
    reloadOnce(marks, reload, asks, first);
    reloadOnce(marks, reload, asks, second);
    expect(reloads.count).toBe(1);
  });

  it("reloads again from the page whose reload did not happen", () => {
    const marks = memory();
    const { reloads, reload } = counting();
    reloadOnce(marks, reload, asks, first);
    reloadOnce(marks, reload, asks, first);
    reloadOnce(marks, reload, rules, first);
    expect(reloads.count).toBe(3);
    reloadOnce(marks, reload, asks, second);
    expect(reloads.count).toBe(3);
  });

  it("keeps the first answer's mark when a second fails on the same page", () => {
    const marks = memory();
    const { reloads, reload } = counting();
    reloadOnce(marks, reload, asks, first);
    reloadOnce(marks, reload, rules, first);
    answerRead(marks, rules);
    reloadOnce(marks, reload, asks, second);
    expect(reloads.count).toBe(2);
  });

  it("reads a mark that holds the answer alone, as an older page kept it", () => {
    const marks = memory();
    marks.setItem("askme-reloaded-for", asks);
    const { reloads, reload } = counting();
    reloadOnce(marks, reload, asks, second);
    expect(reloads.count).toBe(0);
    answerRead(marks, asks);
    reloadOnce(marks, reload, asks, second);
    expect(reloads.count).toBe(1);
  });

  it("reloads again once an answer has been read", () => {
    const marks = memory();
    const { reloads, reload } = counting();
    reloadOnce(marks, reload, asks, first);
    answerRead(marks, asks);
    reloadOnce(marks, reload, asks, second);
    expect(reloads.count).toBe(2);
  });

  it("does not reload for a second answer while the first one's mark stands", () => {
    const marks = memory();
    const { reloads, reload } = counting();
    reloadOnce(marks, reload, asks, first);
    reloadOnce(marks, reload, rules, second);
    expect(reloads.count).toBe(1);
  });

  it("keeps the mark when a different answer is read", () => {
    const marks = memory();
    const { reloads, reload } = counting();
    reloadOnce(marks, reload, asks, first);
    answerRead(marks, rules);
    reloadOnce(marks, reload, asks, second);
    reloadOnce(marks, reload, rules, second);
    expect(reloads.count).toBe(1);
  });

  it("reloads for a different answer once the one that reloaded has been read", () => {
    const marks = memory();
    const { reloads, reload } = counting();
    reloadOnce(marks, reload, asks, first);
    answerRead(marks, asks);
    reloadOnce(marks, reload, rules, second);
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
    reloadOnce(refusing, reload, asks);
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
    reloadOnce(refusing, reload, asks);
    expect(reloads.count).toBe(0);
  });

  it("does not reload, or throw, when the storage itself cannot be reached", () => {
    const { reloads, reload } = counting();
    const blocked = storedMarks(() => {
      throw new Error("The operation is insecure.");
    });
    reloadOnce(blocked, reload, asks);
    answerRead(blocked, asks);
    expect(reloads.count).toBe(0);
  });
});
