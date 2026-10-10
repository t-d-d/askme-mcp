// Branch protection lives in the repository's settings, which no pull request
// can see and the offline gate cannot reach. This runs on a schedule and after
// each deploy, signed out, against GitHub's public API.
import { describe, expect, it } from "vitest";
import { z } from "zod";

const repository = z
  .string()
  .regex(/^[\w.-]+\/[\w.-]+$/u)
  .default("t-d-d/askme-mcp")
  .parse(process.env.GITHUB_REPOSITORY);

const rulesSchema = z.array(
  z.object({
    type: z.string(),
    parameters: z
      .object({
        required_status_checks: z
          .array(z.object({ context: z.string() }))
          .optional(),
      })
      .optional(),
  }),
);

describe("fitness: main is protected (repo-and-delivery.md)", () => {
  it("refuses direct pushes to main and requires the gate", async () => {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/rules/branches/main`,
      {
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
        },
      },
    );
    expect(response.status).toBe(200);
    const rules = rulesSchema.parse(await response.json());
    expect(rules.map((rule) => rule.type)).toEqual(
      expect.arrayContaining(["pull_request", "required_status_checks"]),
    );
    const checks = rules.flatMap(
      (rule) => rule.parameters?.required_status_checks ?? [],
    );
    expect(checks.map((check) => check.context)).toContain("gate");
  });
});
