# ADR 1: The page polls, and nothing stays connected

Decided on 9 October 2026: the page polls for changes, and the service holds no live connections and runs no always-on compute.

Parent PRD: [PRD](../../PRD.md)

## Constraint-set delta

Adds [`docs/constraints/polling.md`](../constraints/polling.md).

## Context

- One person uses each account, and asks arrive a handful at a time. A card that appears within a few seconds is fresh enough.
- The service should cost nothing while idle, so it is serverless, with no process left running.
- The demo needs a new card to appear on the phone without a manual refresh.
- A live connection would add a connection store, reconnect handling and a second kind of endpoint, for a gain nobody would notice at this scale.

## Decision

The page asks the service for changes on a timer, and nothing stays connected.

1. The page polls every few seconds while it is visible, and once more whenever it becomes visible again. It does not poll while hidden.
2. Each poll asks only for what changed since the last one. A poll with nothing new is one cheap read and returns an empty answer.
3. Every exchange with the service is a short request and response. That includes MCP calls from agents.
4. The service never starts a conversation, with a page or with an agent.

The interval starts at five seconds. It can be tuned without changing this decision.

## Alternatives considered

1. **A live connection from the service, by WebSockets or server-sent events.** Cards would appear instantly. On a serverless platform this needs a managed connection service and a store of who is connected, or a process that never stops. Mobile browsers drop connections in the background anyway, so the page would still need a catch-up fetch. Rejected: more parts and a standing cost, for a gain of a few seconds. An implementer is likely to reinvent this one, so it becomes a "Do not" in the constraint file.
2. **A hosted real-time service.** There would be no compute to run. It is one more account and vendor to set up, and setup time is the scarcest thing in this build. Rejected.
3. **Web push to trigger a refresh.** This needs a service worker and a permission prompt, and on iPhones an install to the home screen. It belongs with the Pings item on the roadmap. Rejected for version 1. When Pings is built, a push can prompt a fetch, and polling stays as the fallback.
4. **Manual refresh only.** The simplest option. Rejected, because a list that has to be refreshed by hand fails as the one place to look.

## Fitness functions

All four run in CI and block a merge.

| Check | What it asserts | What it catches |
| --- | --- | --- |
| No live endpoints | The deployment definition declares no WebSocket route, no streaming response and nothing that runs continuously. | Someone adding a live connection to make the list feel instant. |
| Quiet when hidden | A browser test hides the page, and no poll requests are sent. | A timer that keeps firing in a background tab. |
| New ask appears | A browser test posts an ask, and its card shows within two poll intervals with no reload. | Polling being broken or removed. |
| Idle poll is cheap | A poll with nothing new does a single read and returns an empty answer. | A poll that reloads the whole list every time. |

## Consequences

**Easier**

- The whole service is stateless request and response. It scales to zero and costs almost nothing when idle.
- There is no reconnect logic, and the page works on any network a web page works on.
- Every behaviour can be tested with plain requests.

**Harder, and accepted**

- A card can take up to one interval to appear. The demo film should allow for that pause.
- An open page sends a steady trickle of requests. Pausing when hidden and keeping the idle poll cheap keep that small.
- A dismissal on one device shows on another only after its next poll.
- Polling does nothing while the page is closed. Real pings will need push, which is why they are on the roadmap.
- The daily cap on asks does not limit polls, so the poll endpoint needs its own rate limit.
