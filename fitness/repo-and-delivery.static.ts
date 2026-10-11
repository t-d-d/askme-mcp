import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  readRepoFile,
  readWorkflow,
  readYaml,
  repoFiles,
  templateSchema,
  triggers,
  workflowPaths,
  type Job,
} from "../test/repo";

const deployPath = ".github/workflows/deploy.yml";

const scripts = () =>
  z
    .object({ scripts: z.record(z.string(), z.string()) })
    .parse(JSON.parse(readRepoFile("package.json"))).scripts;
const gatePath = ".github/workflows/gate.yml";

const allJobs = (): [string, Job][] =>
  workflowPaths().flatMap((path) =>
    Object.entries(readWorkflow(path).jobs).map(([id, job]): [string, Job] => [
      `${path} ${id}`,
      job,
    ]),
  );

const runsIn = (job: Job | undefined): string[] =>
  (job?.steps ?? []).flatMap((step) =>
    step.run === undefined ? [] : [step.run],
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

  it("lets only the deploy job ask for a cloud token", () => {
    const asking = workflowPaths().flatMap((path) => {
      const workflow = readWorkflow(path);
      const jobs = Object.entries(workflow.jobs)
        .filter(([, job]) => asksForCloudToken(job.permissions))
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
    for (const name of ["GitHubOwnerId", "GitHubRepoId"]) {
      const parameter = template().Parameters?.[name];
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
  // The check reads the repo's settings, which the offline gate cannot reach,
  // so it is a conformance test and runs every day (ADR 15).
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

  it("sets no GitHub environment on any job", () => {
    const withEnvironment = allJobs()
      .filter(([, job]) => job.environment !== undefined)
      .map(([id]) => id);
    expect(withEnvironment).toEqual([]);
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

  it("gives the workflows no secret but the Serverless Framework access key", () => {
    for (const path of workflowPaths()) {
      const text = readRepoFile(path);
      const secrets = [...text.matchAll(/\bsecrets\.([A-Za-z0-9_]+)/gu)].map(
        (match) => match[1],
      );
      expect(new Set(secrets), path).toEqual(
        new Set(secrets.length === 0 ? [] : ["SERVERLESS_ACCESS_KEY"]),
      );
      expect(text, path).not.toMatch(
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
