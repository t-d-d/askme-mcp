import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { captureLogs, lineText } from "../../test/logs";
import { askTool, limits } from "./ask";
import { Refused, retryBudget } from "./errors";
import { callerOf } from "./identity";
import type { SortRequests } from "./jobs";
import { createLogger } from "./log";
import { rateLimits } from "./rate";
import {
  dailyAskCap,
  type Counted,
  type NewAsk,
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
        "stale_after_minutes",
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

  it("says when to set stale_after_minutes, when to leave it out, and what to do once it passes", () => {
    const { description } = advertised.properties.stale_after_minutes ?? {
      description: "",
    };
    expect(description).toContain(
      "Set it only when the ask stops mattering at that time",
    );
    expect(description).toContain("a passkey prompt that times out");
    expect(description).toContain("a delivery slot that goes");
    expect(description).toContain("Leave it out for a bill that falls due");
    expect(description).toContain("post a new ask with replaces");
  });
});

// A store that counts every call the same way, and answers every post the
// same way. It keeps each ask it is asked to post.
const storeAnswering = (
  posting: Posting,
  counted: Counted,
  sent: NewAsk[] = [],
): Store => {
  const unused = () => Promise.reject(new Error("Not used here."));
  return {
    postAsk: (_, ask) => {
      sent.push(ask);
      return Promise.resolve(posting);
    },
    countAsk: () => Promise.resolve(counted),
    resolveAsk: unused,
    markOpened: unused,
    dismissAsk: unused,
    openAsks: unused,
    asksSince: unused,
    countCall: unused,
    countPoll: unused,
    rules: unused,
    saveRules: unused,
    resaveRules: unused,
    countRulesSave: unused,
    countModelCall: unused,
    modelCapSpent: unused,
    recordModelCapReset: unused,
    askToSort: unused,
    recordSort: unused,
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

// A queue that keeps every sort it is sent, or takes none of them.
const sorter = (refuses = false) => {
  const handed: { account: string; askIds: readonly string[] }[] = [];
  const sorts: SortRequests = {
    queue: (account, askIds) => {
      handed.push({ account, askIds });
      return Promise.resolve(
        refuses
          ? askIds.map((askId) => ({ askId, errorClass: "InternalError" }))
          : [],
      );
    },
  };
  return { handed, sorts };
};

const run = (
  posting: Posting,
  counted: Counted = { counted: true },
  sorts: SortRequests = sorter().sorts,
) =>
  askTool.run(input, {
    caller,
    log: createLogger(caller.requestId),
    store: storeAnswering(posting, counted),
    sorts,
  });

// What the store would post, if the call got that far.
const posted: Posting = {
  kind: "posted",
  id: "AAAAAAAAAAAAAAAAAAAAAAAA",
  replaced: false,
};

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

  it("refuses an account calling too fast as rate_limited, saying how long to wait, and posts nothing", async () => {
    const answer = await run(posted, { counted: false, secondsLeft: 23 });
    expect(answer).toBeInstanceOf(Refused);
    const { code, message } = z
      .object({ code: z.string(), message: z.string() })
      .parse(answer);
    expect(code).toBe("rate_limited");
    expect(message).toContain(`${String(rateLimits.ask.limit)} asks a minute`);
    expect(message).toContain("Wait 23 seconds");
    expect(message).toContain(`at most ${String(retryBudget)} times`);
    expect(logged()).toContain("rate-limited");
  });

  it("says one second, not one seconds", async () => {
    const answer = await run(posted, { counted: false, secondsLeft: 1 });
    expect(z.object({ message: z.string() }).parse(answer).message).toContain(
      "Wait 1 second,",
    );
  });
});

describe("queueing an ask's sort", () => {
  let capture: ReturnType<typeof captureLogs>;
  beforeEach(() => {
    capture = captureLogs();
  });
  afterEach(() => {
    capture.restore();
  });
  const logged = () => capture.lines.map(lineText).join("\n");

  it("queues a new ask's sort, with the account and the id", async () => {
    const { handed, sorts } = sorter();
    expect(await run(posted, { counted: true }, sorts)).toEqual({
      id: posted.id,
      status: "posted",
    });
    expect(handed).toEqual([
      { account: caller.accountId, askIds: [posted.id] },
    ]);
  });

  it("answers as posted when the queue does not take the sort, and says so at warn", async () => {
    const { sorts } = sorter(true);
    expect(await run(posted, { counted: true }, sorts)).toEqual({
      id: posted.id,
      status: "posted",
    });
    expect(capture.lines.map(({ method }) => method)).toContain("warn");
    expect(logged()).toContain("sort-request-failed");
  });

  it("hands nothing on for a repeat, which was handed on when it was new", async () => {
    const { handed, sorts } = sorter();
    await run({ kind: "matched", id: posted.id }, { counted: true }, sorts);
    expect(handed).toEqual([]);
  });

  it("hands nothing on for a refused ask", async () => {
    const { handed, sorts } = sorter();
    await run(posted, { counted: false, secondsLeft: 5 }, sorts);
    await run(
      { kind: "over-cap", resetsAt: new Date("2026-10-12T00:00:00.000Z") },
      { counted: true },
      sorts,
    );
    expect(handed).toEqual([]);
  });
});

describe("the ask tool's stale_after_minutes", () => {
  const most = limits.staleAfterMinutes;
  const refusal = `must be a whole number of minutes from 1 to ${String(most)}`;
  const parse = (minutes: unknown) =>
    askTool.input.safeParse({ ...input, stale_after_minutes: minutes });

  it("allows at most 30 days, as an ask is deleted a month after it is posted", () => {
    expect(most).toBe(30 * 24 * 60);
  });

  it.each([1, 45, most])("takes %d minutes", (minutes) => {
    expect(parse(minutes).data?.stale_after_minutes).toBe(minutes);
  });

  it.each([0, -5, 1.5, most + 1, 1e20, "30", null])(
    "refuses %j once, naming the limit",
    (minutes) => {
      expect(parse(minutes).error?.issues).toEqual([
        expect.objectContaining({
          path: ["stale_after_minutes"],
          message: refusal,
        }),
      ]);
    },
  );

  it("hands the store the minutes as the agent sent them, and none when left out", async () => {
    const sent: NewAsk[] = [];
    for (const args of [{ ...input, stale_after_minutes: 45 }, input]) {
      await askTool.run(args, {
        caller,
        log: createLogger(caller.requestId),
        store: storeAnswering(posted, { counted: true }, sent),
        sorts: sorter().sorts,
      });
    }
    expect(sent[0]).toMatchObject({ staleAfterMinutes: 45 });
    expect(sent[1]).not.toHaveProperty("staleAfterMinutes");
  });
});
