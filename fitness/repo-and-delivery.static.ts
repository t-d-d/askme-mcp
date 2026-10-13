import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  conformancePath,
  deployPath,
  inConformanceEnvironment,
  gatePath,
  readRepoFile,
  readWorkflow,
  readYaml,
  repoFiles,
  runsIn,
  scripts,
  templateSchema,
  triggers,
  workflowPaths,
  type Job,
} from "../test/repo";

const allJobs = (): [string, Job][] =>
  workflowPaths().flatMap((path) =>
    Object.entries(readWorkflow(path).jobs).map(([id, job]): [string, Job] => [
      `${path} ${id}`,
      job,
    ]),
  );

const deployCommand = /\b(?:serverless|sls)\b|\baws\s/u;
const namesAStage = /\b(?:serverless|sls)\b[^\n]*\s(?:--stage|-s)\b/u;

const asksForCloudToken = (
  permissions: Job["permissions"] | undefined,
): boolean =>
  permissions === "write-all" ||
  (typeof permissions === "object" && permissions["id-token"] === "write");

describe("fitness: deploys come only from main (repo-and-delivery.md)", () => {
  it("runs the deploy workflow only on a push to main", () => {
    expect(readWorkflow(deployPath).on).toEqual({
      push: { branches: ["main"] },
    });
  });

  it("deploys only after the gate passes in the same run", () => {
    const { jobs } = readWorkflow(deployPath);
    expect(jobs.gate?.uses).toBe(`./${gatePath}`);
    expect(jobs.deploy?.needs).toBe("gate");
  });

  it("lets only the deploy job, and conformance jobs in their environment, ask for a cloud token", () => {
    const asking = workflowPaths().flatMap((path) => {
      const workflow = readWorkflow(path);
      const jobs = Object.entries(workflow.jobs)
        .filter(([, job]) => asksForCloudToken(job.permissions))
        .filter(([, job]) => !inConformanceEnvironment(path, job))
        .map(([id]) => `${path} ${id}`);
      return asksForCloudToken(workflow.permissions) ? [path, ...jobs] : jobs;
    });
    expect(asking).toEqual([`${deployPath} deploy`]);
  });

  it("runs no deploy command outside the deploy job", () => {
    const deploying = allJobs()
      .filter(([id]) => id !== `${deployPath} deploy`)
      .filter(([, job]) => runsIn(job).some((run) => deployCommand.test(run)))
      .map(([id]) => id);
    expect(deploying).toEqual([]);
  });
});

describe("fitness: only main can assume the deploy role (repo-and-delivery.md)", () => {
  const template = () => readYaml("infra/github-oidc.cfn.yml", templateSchema);

  it("trusts one subject: a job on main in this repo, named by owner and repo ids", () => {
    const role = template().Resources.DeployRole;
    const trust = z
      .object({
        AssumeRolePolicyDocument: z.object({ Statement: z.array(z.unknown()) }),
      })
      .parse(role?.Properties);
    expect(role?.Type).toBe("AWS::IAM::Role");
    expect(trust.AssumeRolePolicyDocument.Statement).toEqual([
      {
        Effect: "Allow",
        Principal: {
          Federated: { "Fn::GetAtt": ["GitHubOidcProvider", "Arn"] },
        },
        Action: "sts:AssumeRoleWithWebIdentity",
        Condition: {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            "token.actions.githubusercontent.com:sub": {
              "Fn::Sub":
                "repo:${GitHubOwner}@${GitHubOwnerId}/${GitHubRepo}@${GitHubRepoId}:ref:refs/heads/main",
            },
          },
        },
      },
    ]);
  });

  it("takes the owner and repo ids as numbers, with no default", () => {
    const parameters = template().Parameters;
    for (const name of ["GitHubOwnerId", "GitHubRepoId"]) {
      const parameter = parameters?.[name];
      expect(parameter?.AllowedPattern, name).toBe("[0-9]+");
      expect(parameter?.Default, name).toBeUndefined();
    }
  });

  it("is applied on deploy with the ids from the run", () => {
    const apply = runsIn(readWorkflow(deployPath).jobs.deploy).find((run) =>
      run.includes("infra/github-oidc.cfn.yml"),
    );
    expect(apply).toMatch(/--stack-name askme\s/u);
    expect(apply).toContain("GitHubOwnerId=${{ github.repository_owner_id }}");
    expect(apply).toContain("GitHubRepoId=${{ github.repository_id }}");
  });
});

describe("fitness: main is protected (repo-and-delivery.md)", () => {
  // The offline gate cannot read the repo's settings, so this check is in the
  // conformance tier (ADR 15).
  it("is a conformance check", () => {
    expect(readRepoFile("conformance/github.conformance.ts")).toContain(
      'describe("fitness: main is protected (repo-and-delivery.md)"',
    );
  });
});

describe("fitness: one environment (repo-and-delivery.md)", () => {
  it("names exactly one stage in the deployment definition", () => {
    const definition = readYaml(
      "serverless.yml",
      z.object({
        provider: z.object({ stage: z.string() }),
        stages: z.unknown().optional(),
      }),
    );
    expect(definition.provider.stage).toMatch(/^[a-z]+$/u);
    expect(definition.stages).toBeUndefined();
  });

  it("spots a stage passed to the framework, and nothing else", () => {
    expect(namesAStage.test("npx serverless deploy --stage dev")).toBe(true);
    expect(namesAStage.test("sls deploy -s dev")).toBe(true);
    expect(namesAStage.test("curl -s https://example.com")).toBe(false);
    expect(namesAStage.test("ln -s a b")).toBe(false);
  });

  it("deploys no other stage", () => {
    const naming = workflowPaths().filter((path) =>
      namesAStage.test(readRepoFile(path)),
    );
    expect(naming).toEqual([]);
  });

  // The conformance environment only names a conformance job's token, so
  // the deploy role refuses it. Nothing deploys to it (ADR 15).
  it("sets no GitHub environment on any job but conformance's", () => {
    const withEnvironment = workflowPaths().flatMap((path) =>
      Object.entries(readWorkflow(path).jobs)
        .filter(([, job]) => job.environment !== undefined)
        .filter(([, job]) => !inConformanceEnvironment(path, job))
        .map(([id]) => `${path} ${id}`),
    );
    expect(withEnvironment).toEqual([]);
  });

  it("tells a conformance job in its environment from any other job", () => {
    const inEnvironment = { environment: "conformance" };
    expect(inConformanceEnvironment(conformancePath, inEnvironment)).toBe(true);
    expect(inConformanceEnvironment(deployPath, inEnvironment)).toBe(false);
    expect(inConformanceEnvironment(conformancePath, {})).toBe(false);
    expect(
      inConformanceEnvironment(conformancePath, {
        environment: { name: "Conformance", url: "https://example.com" },
      }),
    ).toBe(true);
  });
});

describe("fitness: one gate (repo-and-delivery.md)", () => {
  const gate = () => readWorkflow(gatePath);

  it("runs on every pull request under a check named gate", () => {
    const { jobs } = gate();
    expect(triggers(gate())).toEqual(["pull_request", "workflow_call"]);
    expect(Object.keys(jobs)).toEqual(["gate"]);
    expect(jobs.gate?.name).toBe("gate");
  });

  it("runs the one command a developer runs, after installing", () => {
    const runs = runsIn(gate().jobs.gate);
    expect(runs.at(-1)).toBe("npm run gate");
    expect(
      runs
        .slice(0, -1)
        .filter((run) => !/^(?:npm ci|npx playwright install\b)/u.test(run)),
    ).toEqual([]);
  });

  it("chains format, lint, types and tests in that command", () => {
    expect(scripts().gate).toBe(
      "npm run format && npm run lint && npm run types && npm run test",
    );
  });
});

describe("fitness: no long-lived keys (repo-and-delivery.md)", () => {
  const keyShapes: Record<string, RegExp> = {
    "an AWS access key": /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/u,
    "a private key": /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
    "an OpenRouter key": /\bsk-or-v1-[0-9a-f]{32,}/u,
    "a Clerk secret key": /\bsk_(?:test|live)_[0-9A-Za-z]{20,}/u,
  };
  const binary = /\.(?:png|jpe?g|gif|ico|woff2?)$/u;

  it("finds no cloud or service key in any file", () => {
    const found = repoFiles()
      .filter((path) => !binary.test(path))
      .flatMap((path) => {
        const text = readRepoFile(path);
        return Object.entries(keyShapes)
          .filter(([, shape]) => shape.test(text))
          .map(([kind]) => `${kind} in ${path}`);
      });
    expect(found).toEqual([]);
  });

  // Parsed, so YAML comments drop out.
  const parsed = (path: string) =>
    readYaml(path, z.looseObject({ jobs: z.record(z.string(), z.unknown()) }));
  // GitHub reads context and secret names in any case.
  const named = (text: string) =>
    [...text.matchAll(/\bsecrets\.([A-Za-z0-9_]+)/giu)].map((match) =>
      (match[1] ?? "").toUpperCase(),
    );

  it("spots a secret written in any case, and one hidden by name", () => {
    expect(named("${{ Secrets.serverless_access_key }}")).toEqual([
      "SERVERLESS_ACCESS_KEY",
    ]);
    expect("${{ SECRETS['KEY'] }}".match(/\bsecrets\b/giu)).toHaveLength(1);
  });

  it("gives the Serverless key only to deploy, and other secrets only to conformance", () => {
    for (const path of workflowPaths()) {
      const workflow = parsed(path);
      const text = JSON.stringify(workflow);
      const secrets = named(text);
      // Every use names one secret, so none hides as secrets['NAME'],
      // toJSON(secrets) or secrets: inherit.
      expect(text.match(/\bsecrets\b/giu) ?? [], path).toHaveLength(
        secrets.length,
      );
      if (path === deployPath) {
        expect(new Set(secrets), path).toEqual(
          new Set(secrets.length === 0 ? [] : ["SERVERLESS_ACCESS_KEY"]),
        );
        // Only the deploy job holds it, not the gate or the live check.
        const outside = { ...workflow, jobs: { ...workflow.jobs } };
        delete outside.jobs.deploy;
        expect(JSON.stringify(outside), path).not.toMatch(/\bsecrets\b/iu);
      } else if (path === conformancePath) {
        expect(secrets, path).not.toContain("SERVERLESS_ACCESS_KEY");
        // A key is a secret of the conformance environment, so only a job
        // in that environment may name one (ADR 15).
        const outside = { ...workflow, jobs: {} };
        expect(JSON.stringify(outside), path).not.toMatch(/\bsecrets\b/iu);
        for (const [id, job] of Object.entries(readWorkflow(path).jobs)) {
          if (!/\bsecrets\b/iu.test(JSON.stringify(job))) continue;
          expect(inConformanceEnvironment(path, job), id).toBe(true);
        }
      } else {
        expect(secrets, path).toEqual([]);
      }
      expect(readRepoFile(path), path).not.toMatch(
        /aws-access-key-id|aws-secret-access-key|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN/u,
      );
    }
  });
});

describe("fitness: standard runners only (repo-and-delivery.md)", () => {
  const standard = new Set([
    "ubuntu-latest",
    "ubuntu-24.04",
    "ubuntu-22.04",
    "ubuntu-24.04-arm",
    "ubuntu-22.04-arm",
    "windows-latest",
    "windows-2025",
    "windows-2022",
    "windows-11-arm",
    "macos-latest",
    "macos-26",
    "macos-15",
    "macos-14",
  ]);

  it("finds the workflows", () => {
    expect(workflowPaths()).toEqual(
      expect.arrayContaining([deployPath, gatePath]),
    );
  });

  it("names a standard GitHub-hosted runner for every job", () => {
    const other = allJobs()
      .filter(([, job]) =>
        job.uses === undefined
          ? typeof job["runs-on"] !== "string" || !standard.has(job["runs-on"])
          : !job.uses.startsWith("./.github/workflows/"),
      )
      .map(
        ([id, job]) => `${id}: ${JSON.stringify(job["runs-on"] ?? job.uses)}`,
      );
    expect(other).toEqual([]);
  });
});

// The deploy job holds the deploy role, which can change everything, so what
// it runs is fixed to its content, not to a label someone can move (#326).
describe("fitness: the deploy runs pinned code (repo-and-delivery.md)", () => {
  // A local workflow or action is this repo's own code, at this commit.
  const pinned = (uses: string): boolean =>
    uses.startsWith("./") || /^[^@\s]+@[0-9a-f]{40}$/u.test(uses);

  const usesIn = (path: string): string[] =>
    Object.values(readWorkflow(path).jobs).flatMap((job) => [
      ...(job.uses === undefined ? [] : [job.uses]),
      ...(job.steps ?? []).flatMap((step) =>
        step.uses === undefined ? [] : [step.uses],
      ),
    ]);

  it("tells a commit from a tag, a branch or a short SHA", () => {
    expect(
      pinned("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1"),
    ).toBe(true);
    expect(pinned("./.github/workflows/gate.yml")).toBe(true);
    expect(pinned("actions/checkout@v7")).toBe(false);
    expect(pinned("actions/checkout@main")).toBe(false);
    expect(pinned("actions/checkout@3d3c42e")).toBe(false);
    expect(pinned("actions/checkout")).toBe(false);
    expect(pinned("docker://alpine:3")).toBe(false);
  });

  it("names every outside action by a full commit SHA", () => {
    const unpinned = workflowPaths().flatMap((path) =>
      usesIn(path)
        .filter((uses) => !pinned(uses))
        .map((uses) => `${path}: ${uses}`),
    );
    expect(usesIn(deployPath).length).toBeGreaterThan(0);
    expect(unpinned).toEqual([]);
  });

  it("has Dependabot propose updates to the pinned actions", () => {
    const config = readYaml(
      ".github/dependabot.yml",
      z.object({
        version: z.literal(2),
        updates: z.array(
          z.looseObject({
            "package-ecosystem": z.string(),
            directory: z.string().optional(),
          }),
        ),
      }),
    );
    expect(config.updates).toContainEqual(
      expect.objectContaining({
        "package-ecosystem": "github-actions",
        directory: "/",
      }),
    );
  });

  it("holds the Serverless installer at one exact version in the lockfile", () => {
    const { devDependencies } = z
      .object({ devDependencies: z.record(z.string(), z.string()) })
      .parse(JSON.parse(readRepoFile("package.json")));
    const lock = z
      .object({
        packages: z.record(
          z.string(),
          z.looseObject({ version: z.string().optional() }),
        ),
      })
      .parse(JSON.parse(readRepoFile("package-lock.json")));
    expect(devDependencies.serverless).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(lock.packages["node_modules/serverless"]?.version).toBe(
      devDependencies.serverless,
    );
  });

  it("runs the framework from node_modules, never fetched by npx", () => {
    // npm exec and npm x are npx under other names.
    const npx = /\b(?:npx|npm\s+(?:exec|x))\b/u;
    const framework = /\b(?:serverless|sls)\b/u;
    const runs = allJobs().flatMap(([, job]) => runsIn(job));
    expect(runs.filter((run) => npx.test(run) && framework.test(run))).toEqual(
      [],
    );
    expect(
      runs.filter((run) => /--yes\b|\s-y\b/u.test(run) && npx.test(run)),
    ).toEqual([]);
    expect(runsIn(readWorkflow(deployPath).jobs.deploy)).toContain(
      "node_modules/.bin/serverless deploy",
    );
  });

  // The installer package fetches a launcher, and the launcher fetches the
  // framework. Serverless publishes no checksum for either (#344).
  const frameworkVersion = () =>
    readYaml("serverless.yml", z.looseObject({ frameworkVersion: z.string() }))
      .frameworkVersion;
  const checkName = "Check the Serverless launcher and framework";
  const deploySteps = () => readWorkflow(deployPath).jobs.deploy?.steps ?? [];

  it("names one exact framework version", () => {
    expect(frameworkVersion()).toMatch(/^\d+\.\d+\.\d+$/u);
  });

  it("checks the launcher and that version's archive against committed sums", () => {
    const check = deploySteps().find((step) => step.name === checkName);
    const run = check?.run ?? "";
    expect(run).toContain(`version=${frameworkVersion()}\n`);
    expect(run).toContain("sha256sum --check --strict <<EOF\n");
    expect(
      [...run.matchAll(/^[0-9a-f]{64} {2}(\S+)$/gmu)].map((sum) => sum[1]),
    ).toEqual([
      "node_modules/serverless/node_modules/.bin/serverless-linux-amd64-0.0.2",
      "$archive",
    ]);
  });

  it("checks them before the job holds credentials, and so before the deploy", () => {
    const steps = deploySteps();
    const check = steps.findIndex((step) => step.name === checkName);
    const credentials = steps.findIndex(
      (step) =>
        step.uses?.startsWith("aws-actions/configure-aws-credentials@") ??
        false,
    );
    const deploy = steps.findIndex(
      (step) => step.run === "node_modules/.bin/serverless deploy",
    );
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(credentials);
    expect(check).toBeLessThan(deploy);
  });
});
