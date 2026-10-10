# Hosting
Relevance: Where anything runs or is stored, or a new cloud resource, runtime or front-end framework: infra/**, web/** build config, service/** entry points
Decision: AWS only: a static React page on S3 and CloudFront, the API and MCP server on Lambda, data in DynamoDB.

Why: Nothing may run continuously ([ADR 1](../adr/0001-polling.md)), deploys come from GitHub
Actions with short-lived credentials ([ADR 4](../adr/0004-repo-and-delivery.md)), and a second provider
costs setup time the build does not have.

## Rules

- One AWS account, one region, one environment.
- The page is static files. No server rendering.
- The service is short request-and-response Lambda handlers.
- The MCP server runs stateless.
- DynamoDB is on-demand. Every resource scales to zero.
- Expiry is checked on read; never rely on DynamoDB having deleted an
  expired item.
- The dedupe check is one conditional write.

## Do not

- Move the page to Next.js or another server-rendered framework: the
  page is behind sign-in and gains nothing from it.
- Add a second hosting or database provider.
- Add a container, a provisioned table or anything with a fixed
  monthly cost.

History: [ADR 5](../adr/0005-hosting.md)
