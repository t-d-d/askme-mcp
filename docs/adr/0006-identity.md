# ADR 6: Clerk handles sign-in and agent authorisation

Decided on 9 October 2026: Clerk is the identity service. It signs users in on the page, and it is the OAuth authorisation server for agents that connect over MCP. The service itself only verifies tokens.

Parent PRD: [PRD](../../PRD.md)

## Constraint-set delta

Adds [`docs/constraints/identity.md`](../constraints/identity.md).

## Context

- **Agents must connect by OAuth.** Claude's hosted apps connect to a custom MCP server by OAuth, with the client registered by CIMD or DCR. A key pasted by one person is not offered. See [Claude's connector authentication docs](https://claude.com/docs/connectors/building/authentication.md).
- **An OAuth server is a large thing to build.** It needs authorisation, token and registration endpoints, a consent screen, refresh and revocation. That is more work than the rest of this product put together.
- **One sign-in should cover both halves.** An agent's ask must land in the queue of the person who approved its connection, so the page and the agents need the same identity.
- **Hosted services now do this.** [Clerk's docs](https://clerk.com/docs/expressjs/guides/ai/mcp/build-mcp-server.md) say it runs the OAuth server for an MCP server, supports both CIMD and DCR, and ships a helper for the metadata an MCP server must publish.

## Decision

Clerk owns identity, and the service trusts nothing but a verified token.

1. Clerk owns users, sessions, the sign-in screens and the OAuth server. The service stores no passwords and issues no tokens.
2. The page uses Clerk's React components for sign-up and sign-in, and sends Clerk's session token with every API call.
3. Agents connect by OAuth. The MCP endpoint answers a call without a token with a 401 that points to its metadata, and the metadata names Clerk as the authorisation server.
4. Both registration methods are switched on: CIMD, and DCR for clients that do not support CIMD.
5. The service verifies the token on every call and takes the account from it. Nothing in a request body can name an account.
6. Clerk's user id is the account key in the store.
7. Agent tokens carry one scope, `asks:create`, as [ADR 2](0002-agents-write-only.md) sets out.
8. A user removes an agent's connection in Clerk's own account screen. The service builds no screen for that.

**The first test.** Before anything else is built, one Claude cloud session connects through a Clerk development instance to a Lambda that returns a fixed id. If that cannot be made to work, the fallback is WorkOS AuthKit. If that fails too, [ADR 5](0005-hosting.md) is reopened.

## Alternatives considered

1. **Build the OAuth server.** This gives full control and no vendor. Rejected: it is more work than the rest of the product put together.
2. **WorkOS AuthKit.** Its [docs](https://workos.com/docs/authkit/mcp.md) describe the same job, with both registration methods. Not chosen: Clerk also supplies ready-made sign-in screens for React and a helper for the MCP metadata, so one vendor covers both halves with less code. AuthKit is the fallback if Clerk fails the first test.
3. **Amazon Cognito.** It is already on AWS and needs no new account. Rejected: as far as is known, Cognito does not offer the self-service client registration that MCP clients expect, so it would need a custom OAuth layer in front of it. That is alternative 1 again.
4. **A key pasted into each agent.** This is the simplest thing to build. Rejected: Claude's hosted apps do not accept a personal pasted key, and the phone demo depends on a Claude cloud session. An implementer is likely to suggest this, so it becomes a "Do not" in the constraint file.

## Fitness functions

| Check | What it asserts | Where it runs | What it catches |
| --- | --- | --- | --- |
| Every route checks a token | Each API route and MCP tool refuses a call with no token, and a call with another account's token. | CI | A route added without a check. |
| The account comes from the token | A request whose body names another account is handled as the caller's own. | CI | Code that trusts an account id sent by the client. |
| The metadata is served | The MCP endpoint answers 401 with a pointer to its metadata, and the metadata names the expected authorisation server. | CI | The handshake that every client depends on being broken. |
| Real clients connect | Claude's hosted app, Claude Code and Cursor each complete the sign-in against the live environment. | By hand, after a deploy | A change that passes every test but breaks a real client. |

The last check cannot be automated, because it needs each vendor's real client and a person to approve the connection. It is a checklist in the README.

## Consequences

**Easier**

- There is no OAuth server to build or to secure.
- One sign-in covers the page and every agent.
- Sign-up screens and a screen for removing connections come ready-made.

**Harder, and accepted**

- It is a new account, and a vendor in the most security-sensitive path. If Clerk is down, nobody signs in and no agent connects.
- Clerk's MCP helpers target Express and Next.js. On Lambda the service runs Express behind an adapter, or verifies tokens itself.
- Clerk's settings live in its dashboard, outside the repo and outside the gate. They are written down in the README.

**Open points**

- **A domain.** Decided: start on a Clerk development instance, which needs no domain. [Clerk's docs](https://clerk.com/docs/guides/development/managing-environments.md) cap a development instance at 100 users and say it is not suitable for production workloads. A demo can live with both. Its sign-in and consent screens sit on a Clerk address ending in accounts.dev. The docs do not say whether a development instance will act as the OAuth server for a real agent, so the first test settles that. If it will not, askme needs a domain the owner controls and a [production instance](https://clerk.com/docs/guides/development/deployment/production.md).
- **Claude Code's redirect.** It uses a different local port each session. Whether Clerk accepts that needs a live test.
- **Cost.** Clerk's free allowance has not been checked against a public demo.
