import { describe, expect, it } from "vitest";
import {
  clerkHost,
  distribution,
  headersSent,
  pageCsp,
  pagePolicy,
} from "../test/page-csp";

// AWS's managed SecurityHeadersPolicy. The page used it until it had a
// policy of its own (ADR 28). The API still does.
const managedPolicyId = "67f7725c-6f97-4210-82d7-5512b31e9d03";

// What the managed policy sends, by header name in lower case.
const managedHeaders = {
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-xss-protection": "1; mode=block",
};

// A policy's directives, by name, each with its sources. A browser ignores
// a directive's later appearances, so only the first is kept.
function directives(csp: string): Map<string, string[]> {
  const parsed = new Map<string, string[]>();
  for (const text of csp.split(";")) {
    const [name, ...sources] = text.trim().split(/\s+/u);
    if (name !== undefined && name !== "" && !parsed.has(name.toLowerCase())) {
      parsed.set(name.toLowerCase(), sources);
    }
  }
  return parsed;
}

// Schemes that name no outside origin, each with the one directive it may
// appear in.
const localSchemes: Record<string, string> = {
  "data:": "img-src",
  "blob:": "worker-src",
};

// Each source that lets the page reach outside its own address: a host, a
// wildcard, or a scheme other than a local one in its own directive.
function outsideSources(csp: string): string[] {
  return [...directives(csp)].flatMap(([name, sources]) =>
    sources
      .filter(
        (source) =>
          !source.startsWith("'") &&
          localSchemes[source.toLowerCase()] !== name,
      )
      .map((source) => `${name} ${source}`),
  );
}

// What Clerk Protect, Clerk's bot protection, loads into the page: a script
// from its CDN, then a loader and probes from hosts named for the instance,
// which Clerk's own config gives (ADR 30).
const protectSources = [
  "script-src https://cdn.protect.clerk.com",
  "script-src https://*.client.protect.clerk.com",
  // Its probe also tries ports other than 443, which a source with no port
  // does not cover (ADR 32).
  "connect-src https://*.client.protect.clerk.com:*",
];

// Every outside source the policy may name, each in its directive. A pull
// request that makes the page reach a new origin adds it here (ADR 28).
const allowedOutside = [
  `script-src ${clerkHost}`,
  `connect-src ${clerkHost}`,
  ...protectSources,
];

function notListed(csp: string): string[] {
  return outsideSources(csp).filter((entry) => !allowedOutside.includes(entry));
}

// Each source that lets in eval anywhere or inline script, in lower case.
function scriptHoles(csp: string): string[] {
  return [...directives(csp)].flatMap(([name, sources]) =>
    sources
      .map((source) => source.toLowerCase())
      .filter(
        (source) =>
          source === "'unsafe-eval'" ||
          (source === "'unsafe-inline'" && name.startsWith("script-src")),
      )
      .map((source) => `${name} ${source}`),
  );
}

const csp = () => pageCsp().value;

describe("fitness: the page's CSP names only Clerk's origins (content-security-policy.md)", () => {
  it("sends the page one CSP, from a policy of its own", () => {
    expect(csp()).not.toBe("");
  });

  it("keeps every kind of load on the page's own address unless a directive names more", () => {
    expect(directives(csp()).get("default-src")).toEqual(["'self'"]);
  });

  it("names no outside origin but Clerk's host, as the deploy reads it from CLERK_ISSUER, and Clerk Protect's", () => {
    expect(notListed(csp())).toEqual([]);
    expect(outsideSources(csp())).toEqual(
      expect.arrayContaining([
        `script-src ${clerkHost}`,
        `connect-src ${clerkHost}`,
      ]),
    );
  });

  it("lets in what Clerk Protect loads, as the live check heard it", () => {
    expect(outsideSources(csp())).toEqual(
      expect.arrayContaining(protectSources),
    );
  });

  it("forbids framing the page, plugins and a changed base address", () => {
    const parsed = directives(csp());
    expect(parsed.get("frame-ancestors")).toEqual(["'none'"]);
    expect(parsed.get("object-src")).toEqual(["'none'"]);
    expect(parsed.get("base-uri")).toEqual(["'none'"]);
  });

  it("allows no eval anywhere and no inline script", () => {
    expect(scriptHoles(csp())).toEqual([]);
  });

  it("tells an outside origin, a wildcard or a misplaced scheme from the page's own sources", () => {
    expect(
      outsideSources(
        "default-src 'self'; img-src 'self' data: https://images.example; script-src * blob:; worker-src blob:; connect-src https:",
      ),
    ).toEqual([
      "img-src https://images.example",
      "script-src *",
      "script-src blob:",
      "connect-src https:",
    ]);
  });

  it("reads a repeated directive as the browser does, by its first appearance", () => {
    expect(
      outsideSources("script-src *; script-src 'self'; default-src 'self'"),
    ).toEqual(["script-src *"]);
  });

  it("flags a listed host in a directive the list does not give it", () => {
    expect(
      notListed(
        `script-src 'self' ${clerkHost}; frame-src ${clerkHost}; connect-src ${clerkHost}`,
      ),
    ).toEqual([`frame-src ${clerkHost}`]);
  });

  it("flags any port on a source but Clerk Protect's in connect-src", () => {
    expect(
      notListed(
        `script-src 'self' https://*.client.protect.clerk.com:*; connect-src ${clerkHost}:* https://*.client.protect.clerk.com https://*.client.protect.clerk.com:*`,
      ),
    ).toEqual([
      "script-src https://*.client.protect.clerk.com:*",
      `connect-src ${clerkHost}:*`,
      "connect-src https://*.client.protect.clerk.com",
    ]);
  });

  it("tells eval or inline script, in any script directive and any case, from the page's own sources", () => {
    expect(
      scriptHoles(
        "script-src 'self'; script-src-elem 'UNSAFE-INLINE'; script-src-attr 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'Unsafe-Eval'",
      ),
    ).toEqual([
      "script-src-elem 'unsafe-inline'",
      "script-src-attr 'unsafe-inline'",
      "img-src 'unsafe-eval'",
    ]);
  });
});

describe("fitness: the page keeps the managed security headers (content-security-policy.md)", () => {
  it("sends the page every header AWS's managed security policy sent", () => {
    const policy = pagePolicy();
    expect(
      policy,
      "The page's behaviour names no policy of its own.",
    ).toBeDefined();
    expect(
      headersSent(policy ?? { ResponseHeadersPolicyConfig: {} }),
    ).toMatchObject(managedHeaders);
  });

  it("leaves the API on AWS's managed security policy", () => {
    const api = (distribution().CacheBehaviors ?? []).filter(
      (behaviour) => behaviour.PathPattern === "/api/*",
    );
    expect(api).toHaveLength(1);
    expect(api[0]?.ResponseHeadersPolicyId).toBe(managedPolicyId);
  });

  it("reads each security header as CloudFront sends it", () => {
    expect(
      headersSent({
        ResponseHeadersPolicyConfig: {
          SecurityHeadersConfig: {
            StrictTransportSecurity: {
              AccessControlMaxAgeSec: 63072000,
              IncludeSubdomains: true,
              Preload: true,
              Override: true,
            },
            XSSProtection: { Protection: false, Override: true },
          },
          CustomHeadersConfig: {
            Items: [
              { Header: "Permissions-Policy", Value: "()", Override: true },
            ],
          },
        },
      }),
    ).toEqual({
      "strict-transport-security":
        "max-age=63072000; includeSubDomains; preload",
      "x-xss-protection": "0",
      "permissions-policy": "()",
    });
  });
});
