import { describe, expect, it } from "vitest";
import { z } from "zod";
import { routes } from "../service/src/handler";
import { readYaml } from "../test/repo";

const definition = () =>
  readYaml(
    "serverless.yml",
    z.object({
      provider: z.object({
        httpApi: z.object({ authorizers: z.unknown().optional() }).optional(),
      }),
      functions: z.record(
        z.string(),
        z.object({
          handler: z.string(),
          events: z.array(z.record(z.string(), z.unknown())).optional(),
        }),
      ),
    }),
  );

describe("fitness: every route checks a token (identity.md)", () => {
  // The integration tier calls each route the service knows. A route
  // declared here but unknown to the service would never be called there.
  it("deploys exactly the routes the service knows", () => {
    const deployed = Object.values(definition().functions).flatMap((fn) =>
      (fn.events ?? []).map((event) => event.httpApi),
    );
    expect(deployed.every((route) => typeof route === "string")).toBe(true);
    expect([...deployed].sort()).toEqual(Object.keys(routes).sort());
  });

  it("sends every route to the one handler that checks tokens", () => {
    const handlers = Object.values(definition().functions)
      .filter((fn) => (fn.events ?? []).length > 0)
      .map((fn) => fn.handler);
    expect(handlers).toEqual(["service/src/handler.handler"]);
  });

  it("leaves only the metadata open", () => {
    expect(
      Object.entries(routes)
        .filter(([, access]) => access === "public")
        .map(([route]) => route),
    ).toEqual(["GET /.well-known/oauth-protected-resource/mcp"]);
  });

  // The service verifies tokens itself (ADR 6). An authorizer in front of it
  // would be a second place where access is decided.
  it("puts no API Gateway authorizer in front of the handler", () => {
    expect(definition().provider.httpApi?.authorizers).toBeUndefined();
  });
});
