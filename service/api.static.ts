// The page calls its API on its own address, under /api/, and the
// distribution sends those calls on to the HTTP API. The page then needs no
// API address at build time, and no cross-origin rules.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { pagePaths } from "../shared/page-api";
import { readYaml } from "../test/repo";
import { routes } from "./src/routes";

const behaviourSchema = z.looseObject({
  PathPattern: z.string().optional(),
  TargetOriginId: z.string(),
  AllowedMethods: z.array(z.string()),
  CachePolicyId: z.string(),
  OriginRequestPolicyId: z.string().optional(),
});

const distribution = () =>
  readYaml(
    "serverless.yml",
    z.object({
      resources: z.object({
        Resources: z.object({
          WebDistribution: z.object({
            Properties: z.object({
              DistributionConfig: z.object({
                Origins: z.array(z.looseObject({ Id: z.string() })),
                CacheBehaviors: z.array(behaviourSchema),
              }),
            }),
          }),
        }),
      }),
    }),
  ).resources.Resources.WebDistribution.Properties.DistributionConfig;

// AWS's managed policies, by id.
const cachingDisabled = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad";
const allViewerExceptHostHeader = "b689b0a8-53d0-40ab-baf2-68738e2966ac";

describe("the page's API on the page's own address", () => {
  it("serves every page route under /api/", () => {
    for (const path of Object.values(pagePaths)) {
      expect(path).toMatch(/^\/api\//u);
      expect(routes).toHaveProperty(`GET ${path}`, "page");
    }
  });

  it("sends /api/* from the distribution to the HTTP API", () => {
    const { Origins, CacheBehaviors } = distribution();
    const api = CacheBehaviors.find(
      (behaviour) => behaviour.PathPattern === "/api/*",
    );
    expect(api).toBeDefined();
    const origin = Origins.find(
      (candidate) => candidate.Id === api?.TargetOriginId,
    );
    expect(origin).toMatchObject({
      DomainName: {
        "Fn::Sub": "${HttpApi}.execute-api.${AWS::Region}.amazonaws.com",
      },
      CustomOriginConfig: { OriginProtocolPolicy: "https-only" },
    });
  });

  // The token is in the Authorization header, and the answer is one
  // account's, so nothing is cached and every header but Host goes on.
  it("caches nothing, and passes the caller's headers on", () => {
    const api = distribution().CacheBehaviors.find(
      (behaviour) => behaviour.PathPattern === "/api/*",
    );
    expect(api?.CachePolicyId).toBe(cachingDisabled);
    expect(api?.OriginRequestPolicyId).toBe(allViewerExceptHostHeader);
  });
});
