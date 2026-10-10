# ADR 5: AWS, with a static page, Lambda and DynamoDB

Decided on 9 October 2026: the product runs on AWS with nothing always on. The page is a static React single-page app served from S3 through CloudFront, the API and the MCP server run on Lambda, and the data is in DynamoDB.

Parent PRD: [PRD](../../PRD.md)

## Constraint-set delta

Adds [`docs/constraints/hosting.md`](../constraints/hosting.md).

## Context

- **Earlier decisions narrow the choice.** [ADR 1](0001-polling.md) rules out anything that runs continuously. [ADR 4](0004-repo-and-delivery.md) requires deploys from GitHub Actions with short-lived credentials, into one environment.
- **Setup time is the scarcest thing.** The owner already has an AWS account and working knowledge of Lambda, DynamoDB and the Serverless Framework. Any other host means a new account.
- **The data needs are small and specific.** Asks expire after a month, the dedupe record lasts ten minutes, and [ADR 3](0003-idempotency.md) needs a check and a write in one atomic step.
- **The page needs no server.** It sits behind sign-in and polls for data. Nothing has to be rendered on a server, and search engines never see it.
- **The page should use a current, widely known front-end framework**, and stay simple.

## Decision

Everything runs on AWS, on services that cost nothing while idle.

1. **Cloud.** One AWS account, one region and one environment.
2. **The page.** React and TypeScript, built with Vite into static files and served from S3 through CloudFront. It is a single-page app with no server rendering. Versions are the current major releases, pinned in the repo.
3. **The service.** The API and the MCP server run on Lambda, in TypeScript on Node.js, as short request-and-response handlers behind an HTTP API. The MCP server uses the official TypeScript SDK in its stateless mode.
4. **The store.** DynamoDB with on-demand billing. Its conditional write is the atomic check-and-write that [ADR 3](0003-idempotency.md) needs. Its expiry feature removes asks after a month and dedupe records after ten minutes.
5. **Expiry is enforced on read.** DynamoDB deletes expired items late, so every read, and the dedupe check, compares the expiry time for itself.
6. **Deployment.** The deployment definition is in the repo, written for the Serverless Framework. GitHub Actions assumes an AWS role through OIDC to deploy it.

## Alternatives considered

1. **Vercel with Next.js.** This is the most-trodden path for the identity service's MCP helpers, and probably the quickest route to a deployed page. Rejected for three reasons. It needs a new account and a separate database provider. Deploying from GitHub Actions needed a long-lived account token, according to a [2025 thread on Vercel's forum](https://community.vercel.com/t/feature-request-token-less-github-actions-deployments-via-oidc/15908), and the other route is to let Vercel deploy main itself. Both go against [ADR 4](0004-repo-and-delivery.md). And server rendering adds nothing to a page behind sign-in. An implementer is likely to suggest this, so it becomes a "Do not" in the constraint file.
2. **Railway.** It runs a container that [sleeps after ten minutes idle](https://docs.railway.com/guides/cut-idle-costs-serverless.md). A polling page would keep it awake, and the first request after a sleep can fail while the container starts. Rejected: it goes against [ADR 1](0001-polling.md), and it is a new account.
3. **Next.js on AWS.** This keeps the cloud but needs an adapter layer to run the framework on Lambda. Rejected: more moving parts, for server features this page does not use.
4. **A relational database.** Querying would be more familiar. Rejected: the data is a few items per user, read by account. A relational database adds connections to manage from Lambda and a second thing to set up, for queries this product does not need.

## Fitness functions

All four run in CI and block a merge.

| Check | What it asserts | What it catches |
| --- | --- | --- |
| The page is static | The page's build output is static files only, and the deployment definition has no function that renders pages. | Server rendering being added. |
| Nothing runs continuously | The deployment definition declares only on-demand resources. This is the same check as [ADR 1](0001-polling.md)'s. | A container, a provisioned database or a fixed-capacity table. |
| Expiry holds on read | A test stores an item whose expiry time has passed, and no read or dedupe check returns it. | Trusting DynamoDB to have deleted it already. |
| The deploy role is assumed | The deploy workflow uses OIDC and holds no AWS access key. | A static AWS key being configured. |

## Consequences

**Easier**

- There is no new hosting account, and idle cost is close to zero.
- [ADR 3](0003-idempotency.md)'s atomic check-and-write is a single conditional write.
- The route from GitHub Actions to AWS by an assumed role is already familiar.
- The page, the service and the store are all defined in one place in the repo.

**Harder, and accepted**

- The identity service's MCP helpers target Express and Next.js. On Lambda the service must run Express behind an adapter, or verify tokens itself. This is unproven, and [ADR 6](0006-identity.md) makes it the first thing to test.
- A Lambda that has been idle is slow on its first request. That includes an agent's first ask.
- DynamoDB can only be read along keys chosen at design time. Listing one account's open asks is the access pattern to design for.
- There is more infrastructure to write than on a platform that hosts a framework for you: a bucket, a distribution, an API and roles.
- The Serverless Framework needs an access key when it runs in CI. It is kept as a GitHub repo secret, and [ADR 4](0004-repo-and-delivery.md) names it as the one long-lived secret CI holds.
