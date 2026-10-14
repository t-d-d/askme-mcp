import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { send, serviceAhead } from "./load";

const at = (iso: string) => Date.parse(iso);

const answered = (date?: string) =>
  new Response(null, date === undefined ? {} : { headers: { date } });

describe("how far the service's clock is ahead of this browser's", () => {
  it("is read from the Date header of the service's answer", () => {
    const received = at("2026-10-12T23:55:00Z");
    expect(
      serviceAhead(answered("Mon, 12 Oct 2026 23:58:00 GMT"), received),
    ).toBe(3 * 60 * 1000);
    expect(
      serviceAhead(answered("Tue, 13 Oct 2026 00:01:00 GMT"), received),
    ).toBe(6 * 60 * 1000);
  });

  it("is behind when this browser's clock is fast", () => {
    expect(
      serviceAhead(
        answered("Mon, 12 Oct 2026 23:58:00 GMT"),
        at("2026-10-13T00:01:00Z"),
      ),
    ).toBe(-3 * 60 * 1000);
  });

  it("is nothing when the answer has no Date header, or one that is not a time", () => {
    const received = at("2026-10-12T23:55:00Z");
    expect(serviceAhead(answered(), received)).toBe(0);
    expect(serviceAhead(answered("soon"), received)).toBe(0);
  });
});

describe("a save's answer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const answering = (body: string) => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(body)));
  };
  const saved = z.object({ text: z.string() });
  const token = () => Promise.resolve("token");

  it("is the answer read by its schema", async () => {
    answering(JSON.stringify({ text: "#work" }));
    await expect(send("/rules", {}, saved, token)).resolves.toEqual({
      text: "#work",
    });
  });

  it("is null, not an error, when the save went through but its answer fails its schema", async () => {
    answering(JSON.stringify({ shape: "new" }));
    await expect(send("/rules", {}, saved, token)).resolves.toBeNull();
  });

  it("is an error when it is not JSON at all", async () => {
    answering("<!doctype html>");
    await expect(send("/rules", {}, saved, token)).rejects.toThrow();
  });
});
