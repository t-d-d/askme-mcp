// Conformance checks for GitHub (ADR 15). They read the repo's settings,
// which no pull request can see, signed out and read only.
import { describe, expect, it } from "vitest";
import { z } from "zod";

const repository = z
  .string()
  .regex(/^[\w.-]+\/[\w.-]+$/u)
  .default("t-d-d/askme-mcp")
  .parse(process.env.GITHUB_REPOSITORY);

// Reads a path under the repo from GitHub's API. The body is kept as text,
// so a failed check shows GitHub's own words and a refusal such as a rate
// limit is not read as drift.
async function github(path: string): Promise<{ status: number; body: string }> {
  const response = await fetch(
    `https://api.github.com/repos/${repository}${path}`,
    {
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
    },
  );
  return { status: response.status, body: await response.text() };
}

function parse<T>(body: string, schema: z.ZodType<T>): T {
  const data: unknown = JSON.parse(body);
  return schema.parse(data);
}

const rulesSchema = z.array(
  z.object({
    type: z.string(),
    parameters: z
      .object({
        required_status_checks: z
          .array(z.object({ context: z.string() }))
          .optional(),
        strict_required_status_checks_policy: z.boolean().optional(),
      })
      .optional(),
  }),
);

const environmentSchema = z.object({
  deployment_branch_policy: z
    .object({
      protected_branches: z.boolean(),
      custom_branch_policies: z.boolean(),
    })
    .nullable(),
});

const branchPoliciesSchema = z.object({
  branch_policies: z.array(z.object({ name: z.string() })),
});

describe("fitness: main is protected (repo-and-delivery.md)", () => {
  // Both checks read the same rules, so they share one request against
  // the signed-out rate limit.
  let mainRules: Promise<{ status: number; body: string }> | undefined;
  async function rulesForMain(): Promise<z.infer<typeof rulesSchema>> {
    mainRules ??= github("/rules/branches/main");
    const { status, body } = await mainRules;
    expect(status, body).toBe(200);
    return parse(body, rulesSchema);
  }

  function requiresGate(rule: z.infer<typeof rulesSchema>[number]): boolean {
    return (rule.parameters?.required_status_checks ?? []).some(
      (check) => check.context === "gate",
    );
  }

  it("refuses direct pushes to main and requires the gate", async () => {
    const rules = await rulesForMain();
    expect(rules.map((rule) => rule.type)).toEqual(
      expect.arrayContaining(["pull_request", "required_status_checks"]),
    );
    const checks = rules.flatMap(
      (rule) => rule.parameters?.required_status_checks ?? [],
    );
    expect(checks.map((check) => check.context)).toContain("gate");
  });

  // Two branches that each pass alone can leave main red once both merge.
  // A branch behind main has to merge main in, so the gate runs on the
  // combined tree first (#43).
  it("requires a branch to be up to date with main before it merges", async () => {
    const strict = (await rulesForMain())
      .filter(requiresGate)
      .map((rule) => rule.parameters?.strict_required_status_checks_policy);
    expect(
      strict,
      "the rule that requires the gate lets a branch behind main merge",
    ).toContain(true);
  });
});

// A conformance job that signs in runs in this environment, so its keys,
// and the AWS role that trusts its token, are only as safe as the rule that
// only main may use it (ADR 15).
describe("fitness: only main may use the conformance environment (test-tiers.md)", () => {
  it("keeps the environment to main, once the owner has made it", async () => {
    const { status, body } = await github("/environments/conformance");
    // Until the first check needs a credential, there is no environment and
    // nothing to keep to main.
    if (status === 404) return;
    expect(status, body).toBe(200);
    const policy = parse(body, environmentSchema).deployment_branch_policy;
    expect(policy, "the environment lets any branch use it").not.toBeNull();
    if (policy?.custom_branch_policies === true) {
      const branches = await github(
        "/environments/conformance/deployment-branch-policies",
      );
      expect(branches.status, branches.body).toBe(200);
      const names = parse(branches.body, branchPoliciesSchema).branch_policies;
      expect(names.map((rule) => rule.name)).toEqual(["main"]);
    } else {
      // Only protected branches may use it, and main is the one protected.
      expect(policy?.protected_branches).toBe(true);
    }
  });
});
