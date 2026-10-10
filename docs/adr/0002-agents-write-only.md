# ADR 2: Agents can write asks and read nothing

Decided on 9 October 2026: an agent connection can post, replace and resolve asks, and can read nothing about the account. That covers the user's rules and hashtags, other agents' asks, and its own asks.

Parent PRD: [PRD](../../PRD.md)

## Constraint-set delta

Adds [`docs/constraints/agents-write-only.md`](../constraints/agents-write-only.md).

## Context

- One account's agents work on unrelated parts of a person's life, often for different vendors. Each agent sees only its own part.
- The hashtags and rules describe the whole of that life, and so does the queue of asks.
- Any tool that returns account data to one agent shows it the other parts, and shows them to its vendor too.
- Agents have no need to read. An agent holds the ids of the asks it posted, and the service sorts without its help.

## Decision

An agent connection can write asks and read nothing.

1. The MCP server exposes exactly two tools, **ask** and **resolve**. An ask can name an earlier ask to replace.
2. Version 1 issues one OAuth scope, `asks:create`, which covers both tools. No scope grants a read.
3. A tool result carries the ask's id and a status, and nothing else about the account. It never includes hashtags, priority, the reason, counts or other asks.
4. The id is the only handle on an ask. Ids are long random values, so an agent can replace or resolve only an ask whose id it was given.
5. An id from another account is refused in exactly the same way as an id that does not exist.
6. **resolve** can be called twice with the same result, and its answer does not say how or by whom the ask was closed.
7. The server's instructions and tool descriptions are the same for every account. They carry nothing about a particular user.

An agent cannot read its own asks either. Nothing it does needs that, and the service could not tell "its own" apart from another session's on the same connection.

## Alternatives considered

1. **Let agents fetch the hashtags and tag their own asks.** The agent knows its own work best. Rejected: it shows every agent the user's whole setup, the tags go stale when the rules change, and the service has to sort on its own anyway. An implementer is likely to reinvent this, so it becomes a "Do not" in the constraint file.
2. **Let an agent list its own open asks.** This would help an agent that lost an id when its context was reset, so it could still resolve or replace the ask. Rejected: the service has no session identity, so "its own" could only mean "this connection's", and one connection is shared by every session of that vendor. The list would show one project's asks to another.
3. **Return the sorting result to the posting agent.** An agent could learn to write better asks from seeing its hashtags and priority. Rejected: it is the same leak by another route.
4. **A read scope the user can grant to a trusted agent.** A voice assistant that reads the queue aloud would need this. Deferred, not rejected. It is the hands-free item on the roadmap, and it would be a separate scope, off by default, added by editing this constraint.

## Fitness functions

All four run in CI and block a merge.

| Check | What it asserts | What it catches |
| --- | --- | --- |
| Tool list is fixed | The server advertises exactly **ask** and **resolve**. | A convenient read tool being added. |
| Results carry no account data | Every tool result matches a schema holding an id and a status only. | Hashtags, priority or the reason leaking into a response. |
| Ids cannot be guessed or borrowed | Ids are long and random, and an id from another account gets the same refusal as an unknown id. | Sequential ids, and one account reaching another's asks. |
| Instructions are the same for all | The server instructions and tool descriptions are constants with no per-account values. | Personalised instructions that reveal a user's setup. |

## Consequences

**Easier**

- The privacy claim is one sentence, and a test can prove it.
- A surface of two tools is hard for an agent to misuse.
- There is no read path to secure or rate-limit.

**Harder, and accepted**

- An agent that loses an id cannot find it again. Its ask stays until the user swipes it away or it expires.
- An agent cannot tell whether its ask was seen or dismissed.
- A retried **ask** call could make a second card, because the agent cannot check for the first. [ADR 3](0003-idempotency.md) records how that is handled.
- Agents cannot learn the user's vocabulary, so what they write in the area field varies. The sorting model absorbs that.
- Roadmap items that need a read, such as hands-free use and rules by conversation, each need a new scope and an edit to this constraint.
