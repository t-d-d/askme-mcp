// The routes API Gateway sends to the service, and who may call each.
// serverless.yml declares the same routes, and a static test keeps the two
// the same.
//
// agent: the MCP endpoint, for an agent's OAuth access token.
// page: the page's API, for the session token of a person signed in.
// public: the metadata that tells an agent where to sign in.
export const routes = {
  "POST /mcp": "agent",
  "GET /mcp": "agent",
  "DELETE /mcp": "agent",
  "GET /.well-known/oauth-protected-resource/mcp": "public",
  "GET /api/asks": "page",
  "GET /api/connection": "page",
} as const satisfies Record<string, "agent" | "page" | "public">;

export type Route = keyof typeof routes;

export type PageRoute = {
  [R in Route]: (typeof routes)[R] extends "page" ? R : never;
}[Route];

export const mcpPath = "/mcp";

export const isRoute = (route: string): route is Route =>
  Object.hasOwn(routes, route);

export const isPageRoute = (route: Route): route is PageRoute =>
  routes[route] === "page";
