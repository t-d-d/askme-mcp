import { describe, expect, it } from "vitest";
import { askRefusalOf, pageRefusalOf } from "../../test/refusals";

describe("a refusal at a rate limit, word for word", () => {
  it("says a poll's limit and the seconds left", async () => {
    expect(await pageRefusalOf("GET /api/asks", 12)).toEqual({
      code: "rate_limited",
      message:
        "The page polled more than 60 times in a minute, which is the limit for an account. Wait 12 seconds, then poll again.",
    });
  });

  it("says one second, not one seconds", async () => {
    expect((await pageRefusalOf("GET /api/asks", 1)).message).toContain(
      "Wait 1 second, then poll again.",
    );
    expect((await pageRefusalOf("PUT /api/rules", 1)).message).toContain(
      "Wait 1 second, then save again.",
    );
    expect(
      (await pageRefusalOf("POST /api/asks/samples", 1)).message,
    ).toContain("Wait 1 second, then send sample asks again.");
    expect((await askRefusalOf(1)).message).toContain(
      "Wait 1 second, then send the same call again,",
    );
  });

  it("says a save's limit and the seconds left", async () => {
    expect(await pageRefusalOf("PUT /api/rules", 12)).toEqual({
      code: "rate_limited",
      message:
        "The rules were saved more than 10 times in a minute, which is the limit for an account. Wait 12 seconds, then save again.",
    });
  });

  it("says the ask limit and the seconds left to the page", async () => {
    expect(await pageRefusalOf("POST /api/asks/samples", 12)).toEqual({
      code: "rate_limited",
      message:
        "This account is posting asks too fast. askme takes at most 30 asks a minute, sample asks included. Wait 12 seconds, then send sample asks again.",
    });
  });

  it("says the ask limit and the seconds left to an agent", async () => {
    expect(await askRefusalOf(12)).toEqual({
      code: "rate_limited",
      message:
        "This account is posting asks too fast. askme takes at most 30 asks a minute. Wait 12 seconds, then send the same call again, at most 2 times in all. If it is still refused, carry on without askme.",
    });
  });
});
