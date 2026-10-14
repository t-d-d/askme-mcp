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
  type Step,
} from "../test/repo";

const allJobs = (): [string, Job][] =>
  workflowPaths().flatMap((path) =>
    Object.entries(readWorkflow(path).jobs).map(([id, job]): [string, Job] => [
      `${path} ${id}`,
      job,
    ]),
  );

const isCredentials = (step: Step): boolean =>
  step.uses?.startsWith("aws-actions/configure-aws-credentials@") ?? false;
const isStackDeploy = (step: Step): boolean =>
  step.run === "node_modules/.bin/serverless deploy";

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

  // The rollback redeploys the last build that passed its live check, in the
  // same run (ADR 25).
  it("lets only the deploy and rollback jobs, and conformance jobs in their environment, ask for a cloud token", () => {
    const asking = workflowPaths().flatMap((path) => {
      const workflow = readWorkflow(path);
      const jobs = Object.entries(workflow.jobs)
        .filter(([, job]) => asksForCloudToken(job.permissions))
        .filter(([, job]) => !inConformanceEnvironment(path, job))
        .map(([id]) => `${path} ${id}`);
      return asksForCloudToken(workflow.permissions) ? [path, ...jobs] : jobs;
    });
    expect(asking).toEqual([`${deployPath} deploy`, `${deployPath} rollback`]);
  });

  it("runs no deploy command outside the deploy and rollback jobs", () => {
    const deploying = allJobs()
      .filter(
        ([id]) =>
          id !== `${deployPath} deploy` && id !== `${deployPath} rollback`,
      )
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

  it("gives the Serverless key only to deploy and rollback, and other secrets only to conformance", () => {
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
        // Only the deploy and rollback jobs hold it, not the gate or a live
        // check.
        const outside = { ...workflow, jobs: { ...workflow.jobs } };
        delete outside.jobs.deploy;
        delete outside.jobs.rollback;
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

  const lockPackages = () =>
    z
      .object({
        packages: z.record(
          z.string(),
          z.looseObject({
            version: z.string().optional(),
            hasInstallScript: z.boolean().optional(),
            os: z.array(z.string()).optional(),
          }),
        ),
      })
      .parse(JSON.parse(readRepoFile("package-lock.json"))).packages;

  it("holds the Serverless installer at one exact version in the lockfile", () => {
    const { devDependencies } = z
      .object({ devDependencies: z.record(z.string(), z.string()) })
      .parse(JSON.parse(readRepoFile("package.json")));
    expect(devDependencies.serverless).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(lockPackages()["node_modules/serverless"]?.version).toBe(
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
    expect(run).toContain(
      '"https://install.serverless.com/archives/serverless-$version.tgz"',
    );
    expect(run).toContain("sha256sum --check --strict <<EOF\n");
    // Nothing unchecked can come from the host once the check has passed.
    expect(run.trimEnd().split("\n").at(-1)).toBe(
      'echo "0.0.0.0 install.serverless.com" | sudo tee -a /etc/hosts > /dev/null',
    );
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
    const credentials = steps.findIndex(isCredentials);
    const deploy = steps.findIndex(isStackDeploy);
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(credentials);
    expect(check).toBeLessThan(deploy);
  });

  // The installer's own install script downloads the launcher. A job that
  // never runs the framework skips install scripts, so it fetches nothing
  // unchecked (#349).
  const runsFramework = (job: Job): boolean =>
    runsIn(job).includes("node_modules/.bin/serverless deploy");
  // On any line of a step, as each of these runs install scripts.
  const installCommand =
    /^\s*npm\s+(?:ci|clean-install|i|install|add|rebuild|rb)\b/mu;
  const installs = (job: Job): string[] =>
    runsIn(job).filter((run) => installCommand.test(run));

  it("skips install scripts in every job that never runs the framework", () => {
    const jobs = allJobs().filter(([, job]) => !runsFramework(job));
    const fetching = jobs.flatMap(([id, job]) =>
      installs(job)
        .filter((run) => run !== "npm ci --ignore-scripts")
        .map((run) => `${id}: ${run}`),
    );
    expect(jobs.filter(([, job]) => installs(job).length > 0).length).toBe(4);
    expect(fetching).toEqual([]);
  });

  // A laptop, or a cloud session, installs with a plain npm ci (#368).
  it("skips install scripts in a plain install", () => {
    const settings = readRepoFile(".npmrc")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !/^[#;]/u.test(line))
      // npm splits at the first "=" and drops a comment after the value.
      .map((line) => /^([^=]*?)\s*=\s*(.*?)(?:\s+[#;].*)?$/u.exec(line))
      .map((match) => [match?.[1], match?.[2]]);
    expect(Object.fromEntries(settings)).toMatchObject({
      "ignore-scripts": "true",
    });
  });

  // The flag on the command line wins over .npmrc.
  const scriptedInstall = "npm ci --ignore-scripts=false";

  it("installs the launcher where it is checked, in the jobs that deploy", () => {
    const deploying = allJobs().filter(([, job]) => runsFramework(job));
    expect(deploying.map(([id]) => id)).toEqual([
      `${deployPath} deploy`,
      `${deployPath} rollback`,
    ]);
    for (const [, job] of deploying) {
      const steps = job.steps ?? [];
      expect(installs(job)).toEqual([scriptedInstall]);
      expect(
        steps.findIndex((step) => step.run === scriptedInstall),
      ).toBeLessThan(steps.findIndex((step) => step.name === checkName));
    }
  });

  // Skipping install scripts is safe only while the installer is the one
  // package on a Linux runner that has one.
  it("has no install script but the installer's on a Linux runner", () => {
    // npm reads "!name" in os as every system but that one.
    const onLinux = (os: string[] | undefined): boolean =>
      os === undefined ||
      os.includes("linux") ||
      (os.every((name) => name.startsWith("!")) && !os.includes("!linux"));
    const scripted = Object.entries(lockPackages())
      .filter(([, entry]) => entry.hasInstallScript === true)
      .filter(([, entry]) => onLinux(entry.os))
      .map(([path]) => path);
    expect(scripted).toEqual(["node_modules/serverless"]);
  });
});

const deployJob = (id: string): Job => {
  const found = readWorkflow(deployPath).jobs[id];
  if (found === undefined) throw new Error(`${deployPath} has no job ${id}`);
  return found;
};
const needsOf = (id: string): string[] => {
  const { needs } = deployJob(id);
  return needs === undefined ? [] : [needs].flat();
};
const stepIndex = (job: Job, found: (step: Step) => boolean): number =>
  (job.steps ?? []).findIndex(found);

// The deploy's step that records its stack deploy has started, and the
// rollback's step that lets the stack settle before its own (ADR 33).
const recordsStart = (step: Step): boolean => step.id === "stack";
const settles = (step: Step): boolean => step.name === "Let the stack settle";
// The rollback's last step, which says in the run summary when it did not
// finish (#412).
const saysUnfinished = (step: Step): boolean =>
  step.name === "Say the rollback did not finish";

// When the live check fails, the same run puts back the last build that
// passed it, then still ends failed so the owner reverts (ADR 25).
describe("fitness: a failed live check redeploys the last good build (repo-and-delivery.md)", () => {
  const lastGood = "${{ needs.find-live-ok.outputs.sha }}";
  const isCheckout = (step: Step): boolean =>
    step.uses?.startsWith("actions/checkout@") ?? false;
  // The job's steps, with its checkout taken back to the commit the run built.
  const checkingOutRun = (steps: Step[] | undefined): Step[] =>
    (steps ?? []).map((step) =>
      isCheckout(step) ? { ...step, with: undefined } : step,
    );

  it("moves live-ok only after the live check passes", () => {
    const mark = deployJob("mark-live-ok");
    expect(needsOf("mark-live-ok")).toEqual(["live"]);
    // A re-run after a rollback checks the build the rollback put back, not
    // the commit the run is for, so only the first attempt moves the tag.
    expect(mark.if).toBe("${{ success() && github.run_attempt == '1' }}");
    expect(runsIn(mark).join("\n")).toMatch(
      /refs\/tags\/live-ok[\s\S]*\$GITHUB_SHA/u,
    );
  });

  it("cannot fail the run by failing to move the tag", () => {
    expect(deployJob("mark-live-ok")["continue-on-error"]).toBe(true);
  });

  it("gives contents: write to the job that moves the tag, and to no other", () => {
    expect(deployJob("mark-live-ok").permissions).toEqual({
      contents: "write",
    });
    const writing = workflowPaths().flatMap((path) => {
      const workflow = readWorkflow(path);
      const writes = (permissions: Job["permissions"]): boolean =>
        permissions === "write-all" ||
        (typeof permissions === "object" && permissions.contents === "write");
      return [
        ...(writes(workflow.permissions) ? [path] : []),
        ...Object.entries(workflow.jobs)
          .filter(([, each]) => writes(each.permissions))
          .map(([id]) => `${path} ${id}`),
      ];
    });
    expect(writing).toEqual([`${deployPath} mark-live-ok`]);
  });

  // ADR 33's check, below, says when the run looks for live-ok.

  it("says so in the run summary when there is no live-ok tag", () => {
    expect(runsIn(deployJob("find-live-ok")).join("\n")).toMatch(
      /no live-ok tag[\s\S]*GITHUB_STEP_SUMMARY/iu,
    );
  });

  it("redeploys only when live-ok names a commit", () => {
    expect(needsOf("rollback")).toEqual(["find-live-ok"]);
    expect(deployJob("rollback").if).toBe(
      "${{ !cancelled() && needs.find-live-ok.outputs.sha != '' }}",
    );
  });

  it("deploys live-ok's stack and page as the deploy does, but not the role's stack", () => {
    const deploy = deployJob("deploy");
    const rollback = deployJob("rollback");
    const checkout = (rollback.steps ?? []).find(isCheckout);
    expect(checkout?.with).toEqual({ ref: lastGood });
    // Only the deploy records that its stack deploy started, and only the
    // rollback lets the stack settle first (ADR 33) and says when it did not
    // finish (#412).
    expect(
      checkingOutRun(rollback.steps).filter(
        (step) => !settles(step) && !saysUnfinished(step),
      ),
    ).toEqual(
      checkingOutRun(deploy.steps).filter(
        (step) =>
          !step.run?.includes("infra/github-oidc.cfn.yml") &&
          !recordsStart(step),
      ),
    );
    expect(JSON.stringify(rollback)).not.toContain("github-oidc");
    expect(rollback.permissions).toEqual(deploy.permissions);
    expect(rollback.outputs).toEqual(
      Object.fromEntries(
        Object.entries(deploy.outputs ?? {}).filter(
          ([name]) => name !== "stack",
        ),
      ),
    );
  });

  // find-live-ok has already said live-ok is being redeployed, so a rollback
  // that stops partway has to say so (#412).
  it("says in the run summary when it does not finish, naming the step that failed", () => {
    const steps = deployJob("rollback").steps ?? [];
    const last = steps.at(-1);
    expect(last !== undefined && saysUnfinished(last)).toBe(true);
    expect(last?.env).toEqual({ STEPS: "${{ toJSON(steps) }}" });
    // It only writes to the summary, so it may run after a failure.
    expect(last?.run).toBe(
      [
        `step=$(jq -r '[to_entries[] | select(.value.outcome == "failure") | .key] | join(", ")' <<< "$STEPS")`,
        'echo "The rollback did not finish: step ${step:-with no id} failed. What is live may not be live-ok." \\',
        '  >> "$GITHUB_STEP_SUMMARY"',
        "",
      ].join("\n"),
    );
    // The steps context holds only the steps that have an id.
    const ids = steps.slice(0, -1).map((step) => step.id);
    expect(ids).not.toContain(undefined);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("writes no such line when it finishes", () => {
    const steps = deployJob("rollback").steps ?? [];
    expect(steps.at(-1)?.if).toBe("failure()");
    expect(
      steps.slice(0, -1).filter((step) => step.run?.includes("did not finish")),
    ).toEqual([]);
  });

  it("runs live-ok's own live tier against what it put back", () => {
    const live = deployJob("live");
    const again = deployJob("rollback-live");
    expect(needsOf("rollback-live")).toEqual(["find-live-ok", "rollback"]);
    // A job with no if is skipped once any job before it failed, and the
    // live job has.
    expect(again.if).toBe(
      "${{ !cancelled() && needs.rollback.result == 'success' }}",
    );
    expect((again.steps ?? []).find(isCheckout)?.with).toEqual({
      ref: lastGood,
    });
    const asLive = JSON.stringify(checkingOutRun(live.steps)).replaceAll(
      "needs.deploy.outputs",
      "needs.rollback.outputs",
    );
    expect(JSON.stringify(checkingOutRun(again.steps))).toBe(asLive);
    expect(again.permissions).toEqual(live.permissions);
  });

  // The live job's failure fails the run. Nothing after it may hide that.
  // A step's continue-on-error hides its failure from the job, as the job's
  // own hides it from the run.
  it("leaves the run failed after a rollback", () => {
    for (const id of ["live", "find-live-ok", "rollback", "rollback-live"]) {
      expect(deployJob(id)["continue-on-error"], id).toBeUndefined();
      const hiding = (deployJob(id).steps ?? []).filter(
        (step) => step["continue-on-error"] !== undefined,
      );
      expect(hiding, id).toEqual([]);
    }
  });
});

// A deploy that fails once its stack deploy has started may have changed what
// is live, so it rolls back as a failed live check does. One that fails
// before has changed nothing, and a cancelled run starts none (ADR 33).
describe("fitness: a failed deploy redeploys the last good build (repo-and-delivery.md)", () => {
  it("records that its stack deploy has started, in the step just before it", () => {
    const deploy = deployJob("deploy");
    const record = stepIndex(deploy, recordsStart);
    expect(record).toBeGreaterThan(-1);
    expect(record).toBe(stepIndex(deploy, isStackDeploy) - 1);
    expect(deploy.steps?.[record]?.run).toBe(
      'echo "stack=started" >> "$GITHUB_OUTPUT"',
    );
    expect(deploy.outputs?.stack).toBe("${{ steps.stack.outputs.stack }}");
  });

  it("looks for live-ok when the live check fails, or the deploy fails having started its stack deploy, and in no other case", () => {
    expect(needsOf("find-live-ok")).toEqual(["deploy", "live"]);
    expect(deployJob("find-live-ok").if).toBe(
      "${{ !cancelled() && (needs.live.result == 'failure' || (needs.deploy.result == 'failure' && needs.deploy.outputs.stack == 'started')) }}",
    );
    expect(deployJob("find-live-ok").permissions).toEqual({ contents: "read" });
  });

  it("names in the run summary which failure started the rollback", () => {
    const find = deployJob("find-live-ok").steps?.find(
      (step) => step.id === "tag",
    );
    const run = find?.run ?? "";
    expect(find?.env).toMatchObject({
      LIVE_RESULT: "${{ needs.live.result }}",
    });
    expect(run).toContain(
      'if [ "$LIVE_RESULT" = failure ]; then\n  cause="The live check failed."\nelse\n  cause="The deploy failed once its stack deploy had started."\nfi\n',
    );
    // Both lines it writes to the summary, with a tag or without, start
    // with the cause.
    expect(run.match(/>> "\$GITHUB_STEP_SUMMARY"/gu)).toHaveLength(2);
    expect(run.match(/^\s*echo "\$cause /gmu)).toHaveLength(2);
  });

  it("leaves the run failed after a deploy that fails partway", () => {
    const deploy = deployJob("deploy");
    expect(deploy["continue-on-error"]).toBeUndefined();
    expect(
      (deploy.steps ?? []).filter(
        (step) => step["continue-on-error"] !== undefined,
      ),
    ).toEqual([]);
  });
});

// CloudFormation refuses an update to a stack that is changing, or stuck in a
// rollback that failed. The rollback tries the undo once more, skipping
// nothing, and deploys nothing over a stack still stuck (ADR 33).
describe("fitness: the rollback deploys over a settled stack (repo-and-delivery.md)", () => {
  const script = (): string => {
    const found = deployJob("rollback").steps?.filter(settles) ?? [];
    expect(found).toHaveLength(1);
    return found[0]?.run ?? "";
  };
  const forcing = /resources-?to-?skip|force-?rollback/iu;

  it("lets the stack settle once it holds credentials, just before it deploys", () => {
    const rollback = deployJob("rollback");
    const settle = stepIndex(rollback, settles);
    expect(stepIndex(rollback, isCredentials)).toBeGreaterThan(-1);
    expect(settle).toBeGreaterThan(stepIndex(rollback, isCredentials));
    expect(settle).toBe(stepIndex(rollback, isStackDeploy) - 1);
    // A step with an if can run after a step before it failed. The one that
    // says the rollback did not finish only writes to the summary.
    expect(
      (rollback.steps ?? [])
        .slice(settle)
        .filter((step) => step.if !== undefined && !saysUnfinished(step)),
    ).toEqual([]);
  });

  it("reads askme-prod's status, and waits while it ends in _IN_PROGRESS", () => {
    const run = script();
    expect(run).toContain(
      'aws cloudformation describe-stacks --stack-name askme-prod \\\n    --query "Stacks[0].StackStatus" --output text\n',
    );
    expect(run).toMatch(
      /\nstack=\$\(status\)\nwhile \[\[ "\$stack" == \*_IN_PROGRESS \]\]; do\n[^]*?\n {2}sleep [1-9][0-9]*\n {2}stack=\$\(status\)\ndone\n/u,
    );
  });

  it("continues a failed rollback once, naming only the stack, and waits for it", () => {
    const run = script();
    expect(run).toMatch(
      /\nif \[ "\$stack" = UPDATE_ROLLBACK_FAILED \]; then\n[^]*?\n {2}if ! \{ aws cloudformation continue-update-rollback --stack-name askme-prod &&\n {6}aws cloudformation wait stack-rollback-complete --stack-name askme-prod; \}; then\n/u,
    );
    // Once: in no loop, and in no other step of any workflow.
    expect(run.match(/^\s*(?:while|until|for|select)\b/gmu)).toHaveLength(1);
    expect(run.indexOf("continue-update-rollback")).toBeGreaterThan(
      run.indexOf("\ndone\n"),
    );
    const continues = allJobs()
      .flatMap(([, job]) => runsIn(job))
      .join("\n")
      .match(/continue-update-rollback/gu);
    expect(continues).toHaveLength(1);
  });

  it("writes each failed resource's reason to the run summary, and stops, when the stack is still stuck", () => {
    expect(script()).toMatch(
      /\n {4}\{\n[^]*?\n {6}aws cloudformation list-stack-resources --stack-name askme-prod \\\n {8}--query "StackResourceSummaries\[\?ends_with\(ResourceStatus, '_FAILED'\)\]\.\[LogicalResourceId, ResourceStatusReason\]" \\\n[^]*?\n {4}\} >> "\$GITHUB_STEP_SUMMARY"\n {4}exit 1\n {2}fi\nfi\n?$/u,
    );
  });

  it("spots a resource skipped or a rollback forced, and nothing else", () => {
    expect(forcing.test("--resources-to-skip WebBucket")).toBe(true);
    expect(forcing.test('{"ResourcesToSkip": ["WebBucket"]}')).toBe(true);
    expect(forcing.test("--force-rollback")).toBe(true);
    expect(
      forcing.test(
        "aws cloudformation continue-update-rollback --stack-name x",
      ),
    ).toBe(false);
  });

  // A step can run a script, or read its arguments from a file, so this
  // reads every file but the docs and these checks.
  it("skips no resource and forces no rollback in any workflow, or any file a step could run", () => {
    const self = "fitness/repo-and-delivery.static.ts";
    const workflows = workflowPaths();
    // Parsed, so a comment that warns against either drops out.
    const text = (path: string): string =>
      workflows.includes(path)
        ? JSON.stringify(readYaml(path, z.unknown()))
        : readRepoFile(path);
    const forced = repoFiles()
      .filter((path) => !path.startsWith("docs/") && !path.endsWith(".md"))
      .filter((path) => path !== self)
      .filter((path) => forcing.test(text(path)));
    expect(workflows.length).toBeGreaterThan(0);
    expect(forced).toEqual([]);
  });
});
