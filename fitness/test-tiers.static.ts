import { describe, expect, it } from "vitest";
import { z } from "zod";
import { importRefused } from "../test/lint";
import {
  conformancePath,
  deployPath,
  gatePath,
  readRepoFile,
  readWorkflow,
  repoFiles,
  runsIn,
  scripts,
  triggers,
  inConformanceEnvironment,
  type Job,
} from "../test/repo";
import { tierPattern, tiers } from "../test/tiers";

const projectsSchema = z.object({
  test: z.object({
    projects: z.array(
      z.object({
        test: z.object({
          name: z.string(),
          include: z.array(z.string()),
          setupFiles: z.array(z.string()),
        }),
      }),
    ),
  }),
});

const projects = async () =>
  projectsSchema.parse((await import("../vitest.config")).default).test
    .projects;

describe("fitness: tiers stay apart (test-tiers.md)", () => {
  it("gives each tier its own suffix, and none is bare .ts", () => {
    const suffixes = tiers.map((tier) => tier.suffix);
    expect(new Set(suffixes).size).toBe(tiers.length);
    for (const suffix of suffixes) expect(suffix).toMatch(/^\.[a-z]+\.ts$/u);
  });

  it("puts every test file in exactly one tier", () => {
    const misplaced = repoFiles()
      .filter((path) => /\.(?:[a-z]+)\.[cm]?[jt]sx?$/u.test(path))
      .filter((path) =>
        /\.(?:static|test|spec|int|browser|live|conformance|e2e)\.[cm]?[jt]sx?$/u.test(
          path,
        ),
      )
      .filter(
        (path) =>
          tiers.filter((tier) => path.endsWith(tier.suffix)).length !== 1,
      );
    expect(misplaced).toEqual([]);
  });

  it("runs each tier's files in a project of its own", async () => {
    expect(
      (await projects()).map(({ test }) => [test.name, test.include]),
    ).toEqual(tiers.map((tier) => [tier.name, [tierPattern(tier)]]));
  });

  it("keeps live and conformance out of the gate", () => {
    expect(
      tiers.filter((tier) => !tier.inGate).map((tier) => tier.suffix),
    ).toEqual([".live.ts", ".conformance.ts"]);
  });

  it("runs the gate's tiers in the gate, and the others on their own", () => {
    const gateTiers = tiers.filter((tier) => tier.inGate);
    expect(scripts().test).toBe(
      `vitest run ${gateTiers.map((tier) => `--project ${tier.name}`).join(" ")}`,
    );
    expect(scripts()["test:live"]).toBe("vitest run --project live");
    expect(scripts().conformance).toBe("vitest run --project conformance");
  });
});

describe("fitness: the gate is offline (test-tiers.md)", () => {
  it("loads the offline guard in every tier the gate runs", async () => {
    const guarded = (await projects())
      .filter(({ test }) => test.setupFiles.includes("test/offline.ts"))
      .map(({ test }) => test.name);
    expect(guarded).toEqual(
      tiers.filter((tier) => tier.inGate).map((tier) => tier.name),
    );
  });

  it("opens a browser only through the helper that keeps it offline", async () => {
    expect(
      await importRefused(
        'import { chromium } from "playwright";\nexport { chromium };\n',
        "web/signed-out.browser.ts",
      ),
    ).toBe(true);
  });
});

describe("fitness: the gate holds no secrets (test-tiers.md)", () => {
  it("declares no secret in the gate's workflow", () => {
    // GitHub reads context names in any case.
    expect(readRepoFile(gatePath)).not.toMatch(/\bsecrets\b/iu);
  });

  it("passes no secret to the gate when deploying", () => {
    const { jobs } = readWorkflow(deployPath);
    expect(jobs.gate?.secrets).toBeUndefined();
  });

  it("gives the gate read-only access", () => {
    expect(readWorkflow(gatePath).permissions).toEqual({
      contents: "read",
    });
  });
});

describe("fitness: conformance runs daily and only reads (test-tiers.md)", () => {
  const path = conformancePath;
  it("runs the conformance tier every day, and nothing else", () => {
    const workflow = readWorkflow(path);
    expect(workflow.name).toBe("conformance");
    expect(triggers(workflow)).toEqual(["schedule", "workflow_dispatch"]);
    expect(Object.keys(workflow.jobs)).toEqual(["conformance"]);
    expect(runsIn(workflow.jobs.conformance)).toEqual([
      "npm ci",
      "npm run conformance",
    ]);
  });

  // A job may read less than the workflow allows. The one thing it may
  // write is a token request, and only in the conformance environment,
  // whose token the deploy role refuses (ADR 15).
  const onlyReads = (job: Job): boolean => {
    const { permissions } = job;
    if (permissions === undefined || permissions === "read-all") return true;
    if (typeof permissions === "string") return false;
    return Object.entries(permissions).every(
      ([scope, level]) =>
        level === "read" ||
        level === "none" ||
        (scope === "id-token" &&
          level === "write" &&
          inConformanceEnvironment(path, job)),
    );
  };

  it("tells a job that only reads from one that could write", () => {
    expect(onlyReads({})).toBe(true);
    expect(onlyReads({ permissions: {} })).toBe(true);
    expect(onlyReads({ permissions: { contents: "read" } })).toBe(true);
    expect(onlyReads({ permissions: { contents: "write" } })).toBe(false);
    expect(onlyReads({ permissions: "write-all" })).toBe(false);
    expect(onlyReads({ permissions: { "id-token": "write" } })).toBe(false);
    expect(
      onlyReads({
        permissions: { "id-token": "write" },
        environment: "conformance",
      }),
    ).toBe(true);
  });

  it("only reads, and cannot reach the deploy role", () => {
    const workflow = readWorkflow(path);
    expect(workflow.permissions).toEqual({ contents: "read" });
    for (const [id, job] of Object.entries(workflow.jobs)) {
      expect(onlyReads(job), id).toBe(true);
    }
    expect(readRepoFile(path)).not.toMatch(/AWS_DEPLOY_ROLE_ARN/iu);
  });
});
