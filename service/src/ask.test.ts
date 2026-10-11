import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { captureLogs, lineText } from "../../test/logs";
import { askTool } from "./ask";
import { Refused, retryBudget } from "./errors";
import { callerOf } from "./identity";
import { createLogger } from "./log";
import {
  asksPerMinute,
  dailyAskCap,
  type Posting,
  type Store,
} from "./store/store";

// The input schema as an agent's client receives it.
const advertised = z
  .object({
    properties: z.record(z.string(), z.object({ description: z.string() })),
    required: z.array(z.string()),
  })
  .parse(z.toJSONSchema(askTool.input));

describe("the ask tool's description of its fields", () => {
  it("describes every field", () => {
    expect(Object.keys(advertised.properties).sort()).toEqual(
      [
        "action_link",
        "area",
        "replaces",
        "session_link",
        "spoken_detail",
        "summary",
      ].sort(),
    );
    for (const [field, { description }] of Object.entries(
      advertised.properties,
    )) {
      expect(description.length, field).toBeGreaterThan(20);
    }
  });

  it("requires the summary, the area and the spoken detail", () => {
    expect(advertised.required.sort()).toEqual(
      ["area", "spoken_detail", "summary"].sort(),
    );
  });

  it("asks for a spoken detail written to be heard, saying where the thing waits", () => {
    const { description } = advertised.properties.spoken_detail ?? {
      description: "",
    };
    expect(description).toContain("written to be heard");
    expect(description).toContain("No markdown, code, file paths or raw URLs");
    expect(description).toContain("say where");
    expect(description).toContain("a browser tab on one machine");
  });

  it("says the area is broad, and not shown", () => {
    const { description } = advertised.properties.area ?? { description: "" };
    expect(description).toContain("Broad, not the task in hand");
    expect(description).toContain("not shown");
  });

  it("says each link must be https", () => {
    for (const field of ["action_link", "session_link"]) {
      expect(advertised.properties[field]?.description, field).toContain(
        "https URL",
      );
    }
  });

  it("says an ask already closed in replaces posts this one as new", () => {
    expect(advertised.properties.replaces?.description).toContain(
      "An id askme does not know, or one whose ask is already closed, is ignored",
    );
  });
});

// A store that answers every post the same way.
const storeAnswering = (posting: Posting): Store => {
  const unused = () => Promise.reject(new Error("Not used here."));
  return {
    postAsk: () => Promise.resolve(posting),
    resolveAsk: unused,
    openAsks: unused,
    close: () => undefined,
  };
};

const input = {
  summary: "Approve the plan",
  area: "Home",
  spoken_detail: "The electrician needs a yes or no.",
};

const caller = callerOf({
  token: "test",
  clientId: "test",
  scopes: ["asks:create"],
  extra: { accountId: "user_1", requestId: "req-1" },
});

const run = (posting: Posting) =>
  askTool.run(input, {
    caller,
    log: createLogger(caller.requestId),
    store: storeAnswering(posting),
  });

describe("the ask tool's answer", () => {
  let capture: ReturnType<typeof captureLogs>;
  beforeEach(() => {
    capture = captureLogs();
  });
  afterEach(() => {
    capture.restore();
  });
  const logged = () => capture.lines.map(lineText).join("\n");

  it("gives a matched ask's id exactly as it gives a new one's, and logs the match", async () => {
    const id = "AAAAAAAAAAAAAAAAAAAAAAAA";
    const matched = await run({ kind: "matched", id });
    expect(matched).toEqual(await run({ kind: "posted", id, replaced: false }));
    expect(matched).toEqual({ id, status: "posted" });
    expect(logged()).toContain("ask-deduplicated");
  });

  it("refuses an account over its daily cap as cap_reached, saying when the cap resets", async () => {
    const answer = await run({
      kind: "over-cap",
      resetsAt: new Date("2026-10-12T00:00:00.000Z"),
    });
    expect(answer).toBeInstanceOf(Refused);
    const { code, message } = z
      .object({ code: z.string(), message: z.string() })
      .parse(answer);
    expect(code).toBe("cap_reached");
    expect(message).toContain(`${String(dailyAskCap)} asks`);
    expect(message).toContain("2026-10-12T00:00:00.000Z");
    expect(message).toContain("Do not retry");
    expect(message).toContain("your own session");
    expect(logged()).toContain("cap-reached");
  });

  it("refuses an account posting too fast as rate_limited, saying how long to wait", async () => {
    const answer = await run({ kind: "too-fast", waitSeconds: 23 });
    expect(answer).toBeInstanceOf(Refused);
    const { code, message } = z
      .object({ code: z.string(), message: z.string() })
      .parse(answer);
    expect(code).toBe("rate_limited");
    expect(message).toContain(`${String(asksPerMinute)} asks a minute`);
    expect(message).toContain("Wait 23 seconds");
    expect(message).toContain(`at most ${String(retryBudget)} times`);
    expect(logged()).toContain("rate-limited");
  });

  it("says one second, not one seconds", async () => {
    const answer = await run({ kind: "too-fast", waitSeconds: 1 });
    expect(z.object({ message: z.string() }).parse(answer).message).toContain(
      "Wait 1 second,",
    );
  });
});
