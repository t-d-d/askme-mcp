import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger, events, fieldNames } from "../service/src/log";
import { captureLogs, type Captured } from "../test/logs";

let capture: ReturnType<typeof captureLogs>;
beforeEach(() => {
  capture = captureLogs();
});
afterEach(() => {
  capture.restore();
});

// The one object each line hands to the console, which Lambda's JSON log
// format stores as the line's message.
const record = (line: Captured | undefined): Record<string, unknown> => {
  const [only, ...rest] = line?.args ?? [];
  expect(rest).toEqual([]);
  expect(typeof only).toBe("object");
  return Object.fromEntries(Object.entries(only ?? {}));
};

// The names of what users and agents write, and of secrets (ADR 7).
const content = [
  "summary",
  "area",
  "spoken",
  "detail",
  "link",
  "url",
  "rules",
  "hashtag",
  "email",
  "token",
  "prompt",
  "reply",
  "message",
  "text",
  "body",
];

describe("fitness: fields are allowlisted (logging.md)", () => {
  it("names a small set of fields, none of them content", () => {
    expect([...fieldNames].sort()).toEqual(
      ["accountId", "askId", "errorClass", "status", "tool"].sort(),
    );
    for (const name of fieldNames) {
      for (const word of content) {
        expect(name.toLowerCase(), name).not.toContain(word);
      }
    }
  });

  it("writes the named fields it is given", () => {
    createLogger("req-1").info("ask-posted", {
      accountId: "user_1",
      askId: "ask_1",
      tool: "ask",
    });
    expect(record(capture.lines[0])).toEqual({
      event: "ask-posted",
      requestId: "req-1",
      accountId: "user_1",
      askId: "ask_1",
      tool: "ask",
    });
  });

  it("drops a field forced past its type, and says so", () => {
    const log = createLogger("req-1");
    // The type refuses this call, so it is made without one.
    Reflect.apply(log.info, undefined, [
      "ask-posted",
      { accountId: "user_1", summary: "Fix the roof" },
    ]);
    const written = record(capture.lines[0]);
    expect(JSON.stringify(written)).not.toContain("Fix the roof");
    expect(written).toEqual({
      event: "ask-posted",
      requestId: "req-1",
      fieldsRejected: true,
    });
  });

  it("drops an id that holds more than an id", () => {
    createLogger("req-1").info("ask-posted", {
      accountId: "user_1 Fix the roof",
    });
    expect(JSON.stringify(record(capture.lines[0]))).not.toContain(
      "Fix the roof",
    );
  });

  it("takes no content field by type", () => {
    const log = createLogger("req-1");
    // @ts-expect-error -- summary is content, and no field of that name exists
    log.info("ask-posted", { summary: "Fix the roof" });
    expect(JSON.stringify(record(capture.lines[0]))).not.toContain(
      "Fix the roof",
    );
  });
});

describe("fitness: events are named (logging.md)", () => {
  it("lists events as stable, lower-case, hyphenated names", () => {
    expect(events.length).toBeGreaterThan(0);
    expect(new Set(events).size).toBe(events.length);
    for (const event of events) expect(event).toMatch(/^[a-z]+(?:-[a-z]+)+$/u);
  });

  it("writes the event on every line", () => {
    const log = createLogger("req-1");
    log.info("token-missing");
    log.warn("token-rejected");
    log.error("request-failed");
    expect(capture.lines.map((line) => record(line).event)).toEqual([
      "token-missing",
      "token-rejected",
      "request-failed",
    ]);
  });

  it("takes only an event from the list", () => {
    const log = createLogger("req-1");
    // @ts-expect-error -- an event outside the exported list does not compile
    log.info("something-happened");
    expect(capture.lines).toHaveLength(1);
  });
});

describe("fitness: levels route the line (logging.md)", () => {
  it("writes info, warn and error to the console method of that level, and nothing for debug", () => {
    const log = createLogger("req-1");
    log.info("ask-posted");
    log.warn("ask-posted");
    log.error("ask-posted");
    expect(capture.lines.map((line) => line.method)).toEqual([
      "info",
      "warn",
      "error",
    ]);
    expect(Object.keys(log).sort()).toEqual(["error", "info", "warn"]);
  });

  it("carries the request id on every line", () => {
    const log = createLogger("4b1c6e2a-request");
    log.info("ask-posted");
    log.error("request-failed", { errorClass: "TypeError" });
    for (const line of capture.lines) {
      expect(record(line).requestId).toBe("4b1c6e2a-request");
    }
  });
});
