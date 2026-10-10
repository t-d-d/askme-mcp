# Identity
Relevance: Sign-in, tokens, OAuth, a new route or MCP tool, or anything that reads an account id: service/** handlers and auth, web/** sign-in, MCP metadata
Decision: Clerk owns sign-in and is the OAuth server for agents; the service only verifies tokens and takes the account from them.

Why: MCP clients connect by OAuth with self-service registration, and
an OAuth server is more work than the rest of the product.

## Rules

- The service stores no passwords and issues no tokens.
- Every API route and MCP tool verifies a token on every call.
- The account is taken from the token, never from the request.
- Clerk's user id is the account key in the store.
- An MCP call without a token gets a 401 pointing to the metadata.
- CIMD and DCR are both switched on.
- Agent tokens carry one scope, asks:create.

## Do not

- Add API keys or any second way to authenticate: Claude's hosted
  apps cannot use them, and two paths double what must be secured.
- Build authorisation, token or registration endpoints here.
- Read an account id from a body, a query string or a header.

Judgment: Whether real clients complete the sign-in can only be
checked by hand against the live environment. See the README checklist.
History: [ADR 6](../adr/0006-identity.md)
