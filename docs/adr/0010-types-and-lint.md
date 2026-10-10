# ADR 10: The compiler and the linter are as strict as they go

Decided on 9 October 2026: TypeScript runs with every strictness option on, lint uses type-aware rules and allows no warnings, and every value that comes in from outside is parsed by a schema before it is used. Types and lint are the first tier of the gate in [ADR 9](0009-test-pyramid.md).

Parent PRD: [PRD](../../PRD.md)

## Constraint-set delta

Adds [`docs/constraints/types-and-lint.md`](../constraints/types-and-lint.md).

## Context

- **Agents write the code.** The compiler and the linter are the cheapest reviewers there are. They read every line on every change, and they answer in seconds.
- **Strictness is cheap on the first day and dear later.** Switching an option on in an existing codebase means fixing every file at once.
- **Language models write the input.** An ask is written by an agent, and a sorting reply by a model. A type that is only asserted says nothing about what actually arrived.
- **Lambda drops work that was not awaited.** When a handler returns, anything still running may never finish, so a forgotten `await` is a silent loss.
- **Other ADRs name rules a linter can hold:** one logger and no content fields ([ADR 7](0007-logging.md)), and a page that never contains service code ([ADR 5](0005-hosting.md)).

## Decision

Every option is on, every escape is closed, and outside data is parsed, not trusted.

**The compiler**

1. `strict` is on, and so are `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals` and `noUnusedParameters`. Unreachable code and unused labels are errors.
2. One base configuration covers the page, the service and the tests. No folder loosens it.
3. `skipLibCheck` stays on. A dependency's own types are not this repo's to fix.

**The escapes**

4. No `any`, written or implied. No non-null assertions. No `@ts-ignore`.
5. `@ts-expect-error` is allowed only with a reason beside it.
6. An unsafe type assertion is a lint error. A cast is never how outside data gets its type.

**The boundaries**

7. Everything from outside is parsed by a schema before it is used: request bodies, MCP tool arguments, model replies, stored items, token claims and environment variables.
8. Types are inferred from the schemas, so a type and its check cannot drift apart. The schema library is Zod, which the MCP SDK already uses.
9. An API route or an MCP tool is registered together with its schemas. A registration without them does not compile.

**Lint**

10. ESLint, with typescript-eslint's strict, type-aware rule set.
11. No promise is left floating, and none is passed where it will be ignored.
12. A `switch` over a set of cases must cover every case.
13. A rule is an error or it is off. There are no warnings.
14. Switching a rule off on a line needs a written reason beside it. A rule is never switched off for a whole file.
15. The page also has React's hooks rules and accessibility rules.
16. The page cannot import service code, and the service cannot import the page. Shared types live in one module that imports neither.
17. When an ADR sets a rule about code, a project lint rule in the repo holds it. [ADR 7](0007-logging.md)'s rules on the logger are the first.

**Formatting**

18. Prettier with its default settings, checked in the gate. Lint carries no style rules.

## Alternatives considered

1. **`strict` and nothing more.** This is the common setting. Rejected: it leaves two holes that matter here. A lookup in a list or a record is typed as always finding something, and an optional field is treated the same as one set to undefined.
2. **Start loose and tighten as the code settles.** Rejected: agents write to whatever the compiler lets through, and tightening later means fixing everything at once.
3. **Give outside data its type by assertion.** It is less code than a schema. Rejected: both writers of askme's input are language models. An implementer is likely to reach for this, so it becomes a "Do not" in the constraint file.
4. **One combined tool for lint and formatting.** It would be faster, with one configuration. Rejected: the rules this decision leans on are type-aware ones, for floating promises, incomplete switches and unsafe assertions, and they come from typescript-eslint.
5. **Warnings for the softer rules.** Rejected: warnings pile up unread, for the same reason [ADR 8](0008-alerting.md) does not alarm on them.

## Fitness functions

All five run in CI and block a merge.

| Check | What it asserts | What it catches |
| --- | --- | --- |
| Strict options stay on | A test reads the compiler configuration and finds each named option on, with no folder overriding it. | An option switched off to get a change through. |
| The escapes stay closed | Lint fails on `any`, a non-null assertion, `@ts-ignore`, an unsafe assertion, or a rule switched off with no reason. | The usual ways round the type checker. |
| Boundaries are parsed | A route or tool cannot be registered without its schemas, and lint forbids reading a request body, a model reply or an environment variable anywhere else. | Outside data used without a check. |
| No warnings | No rule is set to warn, and lint allows none. | A pile of warnings nobody reads. |
| Layers stay apart | Lint refuses an import from the page into the service, or the reverse. | Service code, and its secrets, being bundled into the page. |

## Consequences

**Easier**

- Whole kinds of bug are caught before any test runs: a missing `await`, a lookup that found nothing, a case nobody handled.
- A type at a boundary tells the truth, because it came from the check.
- An agent gets a specific, immediate answer when it writes something unsafe.
- Refactoring is safe to hand to an agent.

**Harder, and accepted**

- The code is wordier. Every lookup has to deal with finding nothing.
- `exactOptionalPropertyTypes` is the option most likely to fight a library's types.
- Type-aware lint is slower, because it type-checks the project.
- A schema at every boundary is more to write than a cast.
- Project lint rules are code, and need their own tests.
