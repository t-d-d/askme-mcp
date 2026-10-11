import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { importRefused, reported } from "../test/lint";
import { readYaml } from "../test/repo";

const logsSchema = z.object({
  logFormat: z.string().optional(),
  applicationLogLevel: z.string().optional(),
  systemLogLevel: z.string().optional(),
  logGroup: z.unknown().optional(),
});

const definition = () =>
  readYaml(
    "serverless.yml",
    z.object({
      provider: z.object({
        logs: z.object({ lambda: logsSchema.optional() }).optional(),
      }),
      functions: z
        .record(
          z.string(),
          z.object({
            logs: logsSchema.optional(),
            disableLogs: z.boolean().optional(),
          }),
        )
        .optional(),
    }),
  );

describe("fitness: JSON everywhere (logging.md)", () => {
  it("declares the service's functions", () => {
    expect(Object.keys(definition().functions ?? {})).toContain("mcp");
  });

  it("gives every function the JSON log format, at info level", () => {
    const { provider, functions } = definition();
    const shared = provider.logs?.lambda ?? {};
    const effective = Object.entries(functions ?? {}).map(([name, fn]) => ({
      name,
      format: fn.logs?.logFormat ?? shared.logFormat,
      level: fn.logs?.applicationLogLevel ?? shared.applicationLogLevel,
      disabled: fn.disableLogs ?? false,
    }));
    expect(effective.length).toBeGreaterThan(0);
    for (const fn of effective) {
      expect(fn, fn.name).toEqual({
        name: fn.name,
        format: "JSON",
        level: "INFO",
        disabled: false,
      });
    }
  });
});

describe("fitness: one way to log (logging.md)", () => {
  const servicePath = "service/src/ask.ts";

  // The first type-aware lint of a file loads its project, which takes longer
  // than one test may.
  beforeAll(async () => {
    await reported("", servicePath);
  }, 60_000);

  it.each([
    "console.log",
    "console.info",
    "console.warn",
    "console.error",
    "console.debug",
  ])("refuses %s in service code", async (call) => {
    expect(await reported(`${call}("x");\n`, servicePath)).toContain(
      "no-console",
    );
  });

  it.each(["process.stdout.write", "process.stderr.write"])(
    "refuses %s in service code",
    async (call) => {
      expect(await reported(`${call}("x");\n`, servicePath)).toContain(
        "no-restricted-properties",
      );
    },
  );

  it.each([
    "pino",
    "winston",
    "bunyan",
    "loglevel",
    "debug",
    "log4js",
    "consola",
    "@aws-lambda-powertools/logger",
  ])("refuses another logger, %s, in service code", async (name) => {
    expect(
      await importRefused(
        `import logger from "${name}";\nexport { logger };\n`,
        servicePath,
      ),
    ).toBe(true);
  });

  it("lets service code import the shared logger", async () => {
    expect(
      await importRefused(
        'import { createLogger } from "./log";\nexport { createLogger };\n',
        servicePath,
      ),
    ).toBe(false);
  });
});
