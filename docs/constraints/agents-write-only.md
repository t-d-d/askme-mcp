# Agents write only
Relevance: The MCP tool surface, tool results, OAuth scopes or server instructions: the MCP server and its tools, token checks, anything returned to an agent
Decision: An agent connection can post, replace and resolve asks, and can read nothing about the account.

Why: One account's agents work on unrelated parts of a person's life.
Anything one agent can read, it learns about the others.

## Rules

- The server exposes exactly two tools: ask and resolve.
- One scope, asks:create. No scope grants a read.
- A tool result carries an id and a status, never account data.
- Ids are long random values. The id is the only handle on an ask.
- An id from another account is refused exactly like an unknown id.
- resolve is idempotent and does not say how an ask was closed.
- Server instructions and tool descriptions are the same for every
  account.

## Do not

- Add a tool that lists or fetches asks, even an agent's own: one
  connection is shared by many sessions.
- Return hashtags, priority or the reason from ask.
- Let agents fetch the hashtags to tag their own asks: it exposes the
  user's setup, and tags go stale when rules change.

History: [ADR 2](../adr/0002-agents-write-only.md)
