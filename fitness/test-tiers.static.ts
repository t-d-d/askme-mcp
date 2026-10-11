import { describe, expect, it } from "vitest";
import { z } from "zod";
import { importRefused } from "../test/lint";
import {
  readRepoFile,
  readWorkflow,
  repoFiles,
  runsIn,
  triggers,
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

const scripts = () =>
  z
    .object({ scripts: z.record(z.string(), z.string()) })
    .parse(JSON.parse(readRepoFile("package.json"))).scripts;

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
    expect(readRepoFile(".github/workflows/gate.yml")).not.toMatch(
      /\bsecrets\b/u,
    );
  });

  it("passes no secret to the gate when deploying", () => {
    const { jobs } = readWorkflow(".github/workflows/deploy.yml");
    expect(jobs.gate?.secrets).toBeUndefined();
  });

  it("gives the gate read-only access", () => {
    expect(readWorkflow(".github/workflows/gate.yml").permissions).toEqual({
      contents: "read",
    });
  });
});

describe("fitness: conformance runs daily and only reads (test-tiers.md)", () => {
  const path = ".github/workflows/conformance.yml";
  it("runs the conformance tier every day, and nothing else", () => {
    const workflow = readWorkflow(path);
    expect(workflow.name).toBe("conformance");
    expect(triggers(workflow)).toContain("schedule");
    expect(runsIn(workflow.jobs.conformance)).toEqual([
      "npm ci",
      "npm run conformance",
    ]);
  });

  it("only reads, and cannot reach the deploy role", () => {
    const workflow = readWorkflow(path);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.conformance?.permissions).toBeUndefined();
    expect(readRepoFile(path)).not.toMatch(/AWS_DEPLOY_ROLE_ARN|id-token/u);
  });
});
