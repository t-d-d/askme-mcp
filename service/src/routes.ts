// serverless.yml declares the same routes, and a static test keeps the two
// in step.
export const routes = {
  "POST /mcp": "agent",
  "GET /mcp": "agent",
  "DELETE /mcp": "agent",
  "GET /.well-known/oauth-protected-resource/mcp": "public",
  "GET /api/asks": "page",
  "GET /api/connection": "page",
  "GET /api/rules": "page",
  "PUT /api/rules": "page",
  "POST /api/asks/opened": "page",
  "POST /api/asks/dismissed": "page",
  "POST /api/asks/samples": "page",
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
