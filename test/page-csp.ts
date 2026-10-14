// The headers CloudFront sends with the page, read from serverless.yml, for
// the static checks and the browser tier's page server (ADR 28).
import { z } from "zod";
import { readYaml, resourceSchema } from "./repo";

// Clerk's host, as the deploy fills it in from CLERK_ISSUER.
export const clerkHost = "${env:CLERK_ISSUER}";

export const cspHeaders = [
  "content-security-policy",
  "content-security-policy-report-only",
];

const behaviourSchema = z.object({
  PathPattern: z.string().optional(),
  ResponseHeadersPolicyId: z.unknown(),
});

const distributionSchema = z.object({
  DistributionConfig: z.object({
    DefaultCacheBehavior: behaviourSchema,
    CacheBehaviors: z.array(behaviourSchema).optional(),
  }),
});

const override = { Override: z.boolean() };

const policySchema = z.object({
  ResponseHeadersPolicyConfig: z.object({
    SecurityHeadersConfig: z
      .object({
        ContentSecurityPolicy: z
          .object({ ContentSecurityPolicy: z.string(), ...override })
          .optional(),
        StrictTransportSecurity: z
          .object({
            AccessControlMaxAgeSec: z.number(),
            IncludeSubdomains: z.boolean().optional(),
            Preload: z.boolean().optional(),
            ...override,
          })
          .optional(),
        ContentTypeOptions: z.object(override).optional(),
        FrameOptions: z
          .object({ FrameOption: z.string(), ...override })
          .optional(),
        ReferrerPolicy: z
          .object({ ReferrerPolicy: z.string(), ...override })
          .optional(),
        XSSProtection: z
          .object({
            Protection: z.boolean(),
            ModeBlock: z.boolean().optional(),
            ...override,
          })
          .optional(),
      })
      .optional(),
    CustomHeadersConfig: z
      .object({
        Items: z.array(
          z.object({ Header: z.string(), Value: z.string(), ...override }),
        ),
      })
      .optional(),
  }),
});

export type HeadersPolicy = z.infer<typeof policySchema>;

const resources = () =>
  readYaml(
    "serverless.yml",
    z.object({
      resources: z.object({ Resources: z.record(z.string(), resourceSchema) }),
    }),
  ).resources.Resources;

export function distribution(declared = resources()) {
  const found = Object.values(declared).filter(
    (resource) => resource.Type === "AWS::CloudFront::Distribution",
  );
  if (found.length !== 1) {
    throw new Error(
      `serverless.yml declares ${String(found.length)} CloudFront distributions, not one.`,
    );
  }
  return distributionSchema.parse(found[0]?.Properties).DistributionConfig;
}

// The policy the page's own behaviour names, as a resource in the file, or
// undefined when it names none there, such as one of AWS's managed policies.
export function pagePolicy(): HeadersPolicy | undefined {
  const declared = resources();
  const named = z
    .object({ Ref: z.string() })
    .safeParse(
      distribution(declared).DefaultCacheBehavior.ResponseHeadersPolicyId,
    );
  const resource = named.success ? declared[named.data.Ref] : undefined;
  return resource?.Type === "AWS::CloudFront::ResponseHeadersPolicy"
    ? policySchema.parse(resource.Properties)
    : undefined;
}

// The headers CloudFront sends with a policy, by name in lower case.
export function headersSent(policy: HeadersPolicy): Record<string, string> {
  const security = policy.ResponseHeadersPolicyConfig.SecurityHeadersConfig;
  const sent: Record<string, string> = {};
  const hsts = security?.StrictTransportSecurity;
  if (hsts !== undefined) {
    sent["strict-transport-security"] = [
      `max-age=${String(hsts.AccessControlMaxAgeSec)}`,
      ...(hsts.IncludeSubdomains === true ? ["includeSubDomains"] : []),
      ...(hsts.Preload === true ? ["preload"] : []),
    ].join("; ");
  }
  if (security?.ContentTypeOptions !== undefined) {
    sent["x-content-type-options"] = "nosniff";
  }
  if (security?.FrameOptions !== undefined) {
    sent["x-frame-options"] = security.FrameOptions.FrameOption;
  }
  if (security?.ReferrerPolicy !== undefined) {
    sent["referrer-policy"] = security.ReferrerPolicy.ReferrerPolicy;
  }
  const xss = security?.XSSProtection;
  if (xss !== undefined) {
    sent["x-xss-protection"] = !xss.Protection
      ? "0"
      : xss.ModeBlock === true
        ? "1; mode=block"
        : "1";
  }
  if (security?.ContentSecurityPolicy !== undefined) {
    sent["content-security-policy"] =
      security.ContentSecurityPolicy.ContentSecurityPolicy;
  }
  for (const item of policy.ResponseHeadersPolicyConfig.CustomHeadersConfig
    ?.Items ?? []) {
    sent[item.Header.toLowerCase()] = item.Value;
  }
  return sent;
}

// The page's CSP, enforcing or report-only: the header it is sent in, in
// lower case, and its value.
export function pageCsp(): { header: string; value: string } {
  const policy = pagePolicy();
  if (policy === undefined) {
    throw new Error(
      "The page's behaviour names no response headers policy in serverless.yml.",
    );
  }
  const sent = headersSent(policy);
  const found = cspHeaders.flatMap((header) => {
    const value = sent[header];
    return value === undefined ? [] : [{ header, value }];
  });
  const [only, ...more] = found;
  if (only === undefined || more.length > 0) {
    throw new Error(
      `The page is sent ${String(found.length)} CSP headers, not one.`,
    );
  }
  return only;
}
