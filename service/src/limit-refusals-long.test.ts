import { describe, expect, it, vi } from "vitest";
import { askRefusalOf, pageRefusalOf } from "../../test/refusals";

// Every window is one minute today, so the words for a longer one never run
// against the real limits. Here the three limits a refusal names for its
// window count in five minutes (#224).
vi.mock("./rate", async (original) => ({
  ...(await original<typeof import("./rate")>()),
  rateLimits: {
    poll: { limit: 60, windowMinutes: 5 },
    ask: { limit: 30, windowMinutes: 5 },
    rulesSave: { limit: 10, windowMinutes: 5 },
    modelCall: { limit: 2000, windowMinutes: 24 * 60 },
  },
}));

describe("a refusal at a rate limit with a window longer than a minute", () => {
  it("says a poll's window in minutes", async () => {
    expect((await pageRefusalOf("GET /api/asks", 12)).message).toBe(
      "The page polled more than 60 times in 5 minutes, which is the limit for an account. Wait 12 seconds, then poll again.",
    );
  });

  it("says a save's window in minutes", async () => {
    expect((await pageRefusalOf("PUT /api/rules", 12)).message).toBe(
      "The rules were saved more than 10 times in 5 minutes, which is the limit for an account. Wait 12 seconds, then save again.",
    );
  });

  it("says the ask limit's window in minutes to the page", async () => {
    expect((await pageRefusalOf("POST /api/asks/samples", 12)).message).toBe(
      "This account is posting asks too fast. askme takes at most 30 asks in 5 minutes, sample asks included. Wait 12 seconds, then send sample asks again.",
    );
  });

  it("says the ask limit's window in minutes to an agent", async () => {
    expect((await askRefusalOf(12)).message).toBe(
      "This account is posting asks too fast. askme takes at most 30 asks in 5 minutes. Wait 12 seconds, then send the same call again, at most 2 times in all. If it is still refused, carry on without askme.",
    );
  });
});
