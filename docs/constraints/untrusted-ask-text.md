# Untrusted ask text
Relevance: The sorting prompt, the model call, the parsing of a model reply, or how a sort result is shown: sorting module, prompt builder, model client, card component, eval set
Decision: Ask text is untrusted data. The model picks from fixed answers, has no tools, and nothing it says is returned to an agent.

Why: An honest agent can carry hostile text it read elsewhere. No
prompt makes a model immune, so the defence is limiting what a
successful attack can do.

## Rules

- The reply is a closed schema: hashtags from the user's own list,
  one of three levels, a short reason.
- A reply that fails the schema is discarded whole. The ask stays
  unsorted and is retried.
- The sorting call declares no tools.
- Agent fields go in one delimited section, marked untrusted.
- A delimiter inside a field is escaped before the prompt is built.
- One account's rules and one of its asks per call.
- The reason is shown as plain text, with a length limit.
- Time windows run in code.
- The eval set keeps a hostile group, scored separately.
- Sorting uses providers that do not keep prompts.

## Do not

- Strip or rewrite suspicious phrases: it is an arms race, and it
  mangles honest asks.
- Add a second model to screen asks: it can be attacked the same way.
- Give the sorting model a tool or a free-form field.
- Let the model create a hashtag.
- Render the reason as markup or a link.
- Return anything from sorting to the agent ([ADR 2](../adr/0002-agents-write-only.md)).

Judgment: A new field in the reply is allowed only if code can
check every value it may hold.

History: [ADR 12](../adr/0012-untrusted-ask-text.md)
