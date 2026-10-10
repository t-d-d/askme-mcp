# Polling, no live connections
Relevance: How the page learns of changes, or any new long-lived connection or always-on compute: client data fetching, API routes, the deployment definition
Decision: The page polls for changes; the service holds no live connections and runs no always-on compute.

Why: One person per account and a handful of asks at a time make a
few seconds' delay invisible, and the service must cost nothing idle.

## Rules

- The page polls only while visible, and once on becoming visible.
- A poll asks for changes since the last one. An idle poll is one read.
- Every exchange is a short request and response, MCP calls included.
- The service never initiates contact with a page or an agent.
- The poll endpoint has its own rate limit.

## Do not

- Add WebSockets or server-sent events to make the list feel instant:
  that adds a connection store and a standing cost for a gain of seconds.
- Add a hosted real-time service: another vendor for the same gain.
- Poll while the page is hidden.

History: [ADR 1](../adr/0001-polling.md)
