import { describe, expect, it } from "vitest";
import { fingerprint } from "./fingerprint";
import type { NewAsk } from "./store";

// Every field an agent can send, so each can be changed in turn.
const ask: Required<NewAsk> = {
  summary: "Approve the plan for the kitchen rewiring",
  area: "Home renovation",
  spokenDetail: "The electrician needs a yes or no before Friday.",
  actionLink: "https://github.com/t-d-d/askme-mcp/pull/1",
  sessionLink: "https://claude.ai/code/session_1",
  replaces: "AAAAAAAAAAAAAAAAAAAAAAAA",
};

const fields = [
  "summary",
  "area",
  "spokenDetail",
  "actionLink",
  "sessionLink",
  "replaces",
] as const satisfies (keyof NewAsk)[];

describe("an ask's fingerprint", () => {
  it("is the same for the same ask", () => {
    expect(fingerprint({ ...ask })).toBe(fingerprint(ask));
  });

  it("can go in a sort key", () => {
    expect(fingerprint(ask)).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it.each(fields)("ignores whitespace around the %s", (field) => {
    expect(fingerprint({ ...ask, [field]: ` \n${ask[field]}\t ` })).toBe(
      fingerprint(ask),
    );
  });

  it.each(fields)("changes when the %s changes", (field) => {
    expect(fingerprint({ ...ask, [field]: `${ask[field]}x` })).not.toBe(
      fingerprint(ask),
    );
  });

  const { actionLink, sessionLink, replaces, ...required } = ask;
  const leftOut: Record<string, NewAsk> = {
    actionLink: { ...required, sessionLink, replaces },
    sessionLink: { ...required, actionLink, replaces },
    replaces: { ...required, actionLink, sessionLink },
  };

  it.each(Object.entries(leftOut))(
    "changes when the %s is left out",
    (_, without) => {
      expect(fingerprint(without)).not.toBe(fingerprint(ask));
    },
  );

  it("tells apart the same text split between fields differently", () => {
    const bare = { summary: "ab", area: "c", spokenDetail: "d" };
    expect(fingerprint({ ...bare, summary: "a", area: "bc" })).not.toBe(
      fingerprint(bare),
    );
  });

  it("tells apart one link from the other", () => {
    const bare = { summary: "a", area: "b", spokenDetail: "c" };
    expect(fingerprint({ ...bare, actionLink: ask.actionLink })).not.toBe(
      fingerprint({ ...bare, sessionLink: ask.actionLink }),
    );
  });
});
