# Types and lint
Relevance: Compiler options, lint rules, a new boundary where data enters, or any cast or disabled rule: tsconfig*.json, eslint.config.js, lint-rules/**, schemas
Decision: Every TypeScript strictness option is on, lint is type-aware with no warnings, and outside data is parsed by a schema before use.

Why: Agents write the code and language models write the input, so
the compiler is the first reviewer and an asserted type proves
nothing.

## Rules

- strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes,
  noImplicitOverride, noImplicitReturns, noFallthroughCasesInSwitch,
  noUnusedLocals and noUnusedParameters are on, everywhere.
- No any, no non-null assertion, no @ts-ignore, no unsafe assertion.
- Everything from outside is parsed by a schema: request bodies, tool
  arguments, model replies, stored items, token claims, environment.
- Types are inferred from schemas.
- No floating promises. Every switch is exhaustive.
- A lint rule is an error or off. Zero warnings.
- A disabled rule carries its reason on the same line.
- The page and the service never import each other.
- A code-level rule from an ADR is held by a project lint rule.

## Do not

- Cast outside data to a type: the writers are language models.
- Loosen an option for one folder, tests included.
- Disable a rule for a whole file.
- Add a rule at warn level.

History: [ADR 10](../adr/0010-types-and-lint.md)
