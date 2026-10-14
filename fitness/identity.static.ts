import { describe, expect, it } from "vitest";
import { z } from "zod";
import { routes } from "../service/src/handler";
import { readYaml } from "../test/repo";

const resource = z.object({
  Type: z.string().optional(),
  Properties: z
    .object({ CorsConfiguration: z.unknown().optional() })
    .optional(),
});

const definition = () =>
  readYaml(
    "serverless.yml",
    z.object({
      provider: z.object({
        httpApi: z
          .object({
            authorizers: z.unknown().optional(),
            cors: z.unknown().optional(),
          })
          .optional(),
      }),
      functions: z.record(
        z.string(),
        z.object({
          handler: z.string(),
          events: z.array(z.record(z.string(), z.unknown())).optional(),
        }),
      ),
      resources: z
        .object({
          Resources: z.record(z.string(), resource).optional(),
          extensions: z.record(z.string(), resource).optional(),
        })
        .optional(),
    }),
  );

// A queue trigger is not a route: only askme can send to it (sort-queue.md).
type Fn = ReturnType<typeof definition>["functions"][string];
const routeEvents = (fn: Fn) =>
  (fn.events ?? []).filter((event) => "httpApi" in event || "http" in event);

describe("fitness: every route checks a token (identity.md)", () => {
  // The integration tier calls each route the service knows, so a deployed
  // route the service does not know would go untested.
  it("deploys exactly the routes the service knows", () => {
    const deployed = Object.values(definition().functions).flatMap((fn) =>
      routeEvents(fn).map((event) => event.httpApi),
    );
    expect(deployed.every((route) => typeof route === "string")).toBe(true);
    expect([...deployed].sort()).toEqual(Object.keys(routes).sort());
  });

  it("sends every route to the one handler that checks tokens", () => {
    const handlers = Object.values(definition().functions)
      .filter((fn) => routeEvents(fn).length > 0)
      .map((fn) => fn.handler);
    expect(handlers).toEqual(["service/src/handler.handler"]);
  });

  // The OPTIONS route answers a browser's preflight for the GET.
  it("leaves only the metadata open", () => {
    expect(
      Object.entries(routes)
        .filter(([, access]) => access === "public")
        .map(([route]) => route)
        .sort(),
    ).toEqual([
      "GET /.well-known/oauth-protected-resource/mcp",
      "OPTIONS /.well-known/oauth-protected-resource/mcp",
    ]);
  });

  // The service verifies tokens itself (ADR 6). An authorizer in front of it
  // would be a second place where access is decided.
  it("puts no API Gateway authorizer in front of the handler", () => {
    expect(definition().provider.httpApi?.authorizers).toBeUndefined();
  });

  // API Gateway's own CORS would answer every route's preflight, the MCP
  // endpoint and /api/* included, without reaching the handler, and would
  // replace the handler's answer on the metadata route.
  it("leaves API Gateway's own CORS off", () => {
    expect(definition().provider.httpApi?.cors).toBeUndefined();
  });

  // An extension of the HTTP API the framework makes, or an HTTP API of our
  // own, can set the same CORS.
  it("gives no HTTP API its own CORS", () => {
    const { resources } = definition();
    const apis = [
      ...Object.entries(resources?.Resources ?? {}).filter(
        ([, value]) => value.Type === "AWS::ApiGatewayV2::Api",
      ),
      ...Object.entries(resources?.extensions ?? {}).filter(
        ([name]) => name === "HttpApi",
      ),
    ];
    const withCors = apis
      .filter(([, value]) => value.Properties?.CorsConfiguration !== undefined)
      .map(([name]) => name);
    expect(withCors).toEqual([]);
  });
});
