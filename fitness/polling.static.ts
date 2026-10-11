import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readRepoFile, readYaml, repoFiles, resourceSchema } from "../test/repo";

const definitionSchema = z.object({
  provider: z.looseObject({}),
  functions: z.record(
    z.string(),
    z.looseObject({
      events: z.array(z.record(z.string(), z.unknown())).optional(),
      provisionedConcurrency: z.unknown().optional(),
      url: z.unknown().optional(),
    }),
  ),
  resources: z.object({ Resources: z.record(z.string(), resourceSchema) }),
});

const definition = () => readYaml("serverless.yml", definitionSchema);

// The page's code, the service's and the module they share.
const sourceFiles = () =>
  repoFiles().filter(
    (path) =>
      /^(web\/src|service\/src|shared)\/.*\.tsx?$/u.test(path) &&
      !/\.(test|static|int|browser|live|conformance)\.ts$/u.test(path),
  );

describe("fitness: no live endpoints (polling.md)", () => {
  it("declares no WebSocket route", () => {
    const { provider, functions, resources } = definition();
    const routes = Object.entries(functions)
      .filter(([, fn]) =>
        (fn.events ?? []).some((event) => "websocket" in event),
      )
      .map(([name]) => name);
    expect(routes).toEqual([]);
    expect(
      Object.keys(provider).filter((key) => /websocket/iu.test(key)),
    ).toEqual([]);
    const apis = Object.entries(resources.Resources)
      .filter(([, resource]) =>
        JSON.stringify(resource).toUpperCase().includes("WEBSOCKET"),
      )
      .map(([id]) => id);
    expect(apis).toEqual([]);
  });

  it("declares no streaming response", () => {
    const streaming = Object.entries(definition().functions)
      .filter(([, fn]) =>
        JSON.stringify(fn.url ?? {}).includes("RESPONSE_STREAM"),
      )
      .map(([name]) => name);
    expect(streaming).toEqual([]);
  });

  it("keeps no function running between requests", () => {
    const warm = Object.entries(definition().functions)
      .filter(([, fn]) => fn.provisionedConcurrency !== undefined)
      .map(([name]) => name);
    expect(warm).toEqual([]);
  });

  it("opens no live connection from the page or the service", () => {
    expect(sourceFiles().length).toBeGreaterThan(0);
    const live = sourceFiles().filter((path) =>
      /\b(WebSocket|EventSource)\b|text\/event-stream/u.test(
        readRepoFile(path),
      ),
    );
    expect(live).toEqual([]);
  });
});
