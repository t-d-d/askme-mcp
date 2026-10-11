// Read-only access to the repo's own files, for static tests.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, type Tags } from "yaml";
import { z } from "zod";

export const root = fileURLToPath(new URL("..", import.meta.url));

export function readRepoFile(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

// Every file in the repo that git tracks or would track, so nothing ignored.
// The list is read from git once per test file.
let files: string[] | undefined;
export function repoFiles(): string[] {
  files ??= execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: root, encoding: "utf8" },
  )
    .split("\n")
    .filter((path) => path !== "");
  return [...files];
}

// The scripts in package.json, by name.
export const scripts = (): Record<string, string> =>
  z
    .object({ scripts: z.record(z.string(), z.string()) })
    .parse(JSON.parse(readRepoFile("package.json"))).scripts;

// CloudFormation's short-form functions, such as !Ref and !GetAtt, read as
// their long form, so a template parses to plain data.
const functions = [
  "And",
  "Base64",
  "Cidr",
  "Condition",
  "Equals",
  "FindInMap",
  "GetAtt",
  "GetAZs",
  "If",
  "ImportValue",
  "Join",
  "Not",
  "Or",
  "Ref",
  "Select",
  "Split",
  "Sub",
];

const longName = (name: string): string =>
  name === "Ref" || name === "Condition" ? name : `Fn::${name}`;

const cloudFormationTags: Tags = functions.flatMap((name) => [
  {
    tag: `!${name}`,
    resolve: (value: string) => ({
      [longName(name)]: name === "GetAtt" ? value.split(".") : value,
    }),
  },
  {
    tag: `!${name}`,
    collection: "seq" as const,
    resolve: (value: { toJSON(): unknown }) => ({
      [longName(name)]: value.toJSON(),
    }),
  },
]);

export function readYaml<T>(path: string, schema: z.ZodType<T>): T {
  const data: unknown = parse(readRepoFile(path), {
    customTags: cloudFormationTags,
  });
  return schema.parse(data);
}

// Just enough of a CloudFormation template for the checks to read.
export const resourceSchema = z.object({
  Type: z.string(),
  Properties: z.record(z.string(), z.unknown()).optional(),
});

export const templateSchema = z.object({
  Parameters: z
    .record(
      z.string(),
      z.object({
        Type: z.string(),
        Default: z.unknown().optional(),
        AllowedPattern: z.string().optional(),
      }),
    )
    .optional(),
  Resources: z.record(z.string(), resourceSchema),
  Outputs: z.record(z.string(), z.unknown()).optional(),
});

// Just enough of a GitHub Actions workflow for the checks to read.
const stepSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  uses: z.string().optional(),
  run: z.string().optional(),
  with: z.record(z.string(), z.unknown()).optional(),
  env: z.record(z.string(), z.unknown()).optional(),
});

const jobSchema = z.object({
  name: z.string().optional(),
  "runs-on": z.union([z.string(), z.array(z.string())]).optional(),
  uses: z.string().optional(),
  needs: z.union([z.string(), z.array(z.string())]).optional(),
  if: z.string().optional(),
  permissions: z
    .union([z.string(), z.record(z.string(), z.string())])
    .optional(),
  environment: z.unknown().optional(),
  secrets: z.unknown().optional(),
  steps: z.array(stepSchema).optional(),
});

export const workflowSchema = z.object({
  name: z.string(),
  on: z.union([
    z.string(),
    z.array(z.string()),
    z.record(z.string(), z.unknown()),
  ]),
  permissions: z
    .union([z.string(), z.record(z.string(), z.string())])
    .optional(),
  jobs: z.record(z.string(), jobSchema),
});

export type Workflow = z.infer<typeof workflowSchema>;
export type Job = z.infer<typeof jobSchema>;

// The shell commands a job runs, in order.
export const runsIn = (job: Job | undefined): string[] =>
  (job?.steps ?? []).flatMap((step) =>
    step.run === undefined ? [] : [step.run],
  );

export const gatePath = ".github/workflows/gate.yml";
export const deployPath = ".github/workflows/deploy.yml";
export const conformancePath = ".github/workflows/conformance.yml";

// A conformance job that signs in runs in the GitHub environment
// "conformance". Its token then names that environment, which the deploy
// role does not trust, and its keys are that environment's secrets (ADR 15).
export const inConformanceEnvironment = (path: string, job: Job): boolean =>
  path === conformancePath && job.environment === "conformance";

export const workflowPaths = (): string[] =>
  repoFiles().filter((path) =>
    /^\.github\/workflows\/[^/]+\.ya?ml$/u.test(path),
  );

export function readWorkflow(path: string): Workflow {
  return readYaml(path, workflowSchema);
}

export function triggers(workflow: Workflow): string[] {
  const { on } = workflow;
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on;
  return Object.keys(on);
}
