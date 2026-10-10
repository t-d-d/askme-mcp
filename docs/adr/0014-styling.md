# ADR 14: Styles are plain CSS built from one set of tokens

Decided on 10 October 2026: the page is styled with plain CSS. Every colour, size and radius comes from one file of design tokens, each component has its own CSS Module, and there is no styling library. The font is served from the site itself.

Parent PRD: [PRD](../../PRD.md). The design it implements is in [`docs/design.md`](../design.md).

## Constraint-set delta

Adds [`docs/constraints/styling.md`](../constraints/styling.md).

## Context

- **The design is small and exact.** [`docs/design.md`](../design.md) fixes about ten neutral values, eight hashtag colours, one typeface and a handful of parts. The job is to reproduce it, not to invent.
- **Agents write the page, one issue at a time.** Without a rule, each issue would style its part its own way, and the page would drift from the design a little with every merge.
- **Hashtag colour is data.** Which colour a button takes depends on the ask and on the tab. It cannot be a fixed class name.
- **The page is static and signed-in.** It should load fast on a phone and make no request to anyone but askme and the identity service.

## Decision

Styles are written in CSS, and every value in them is a token.

1. **One tokens file.** `web/src/tokens.css` declares every colour, type size, weight, radius and space as a CSS custom property, with the names used in [`docs/design.md`](../design.md).
2. **Only the tokens file holds raw values.** No other file contains a colour literal, a font name or a font size in pixels.
3. **Each component has a CSS Module** beside it. Vite supports these with no extra tooling, and class names cannot collide.
4. **A hashtag's colour is set once, on the element.** The component sets three custom properties, `--tag-strong`, `--tag-tint` and `--tag-ink`, from the hashtag's palette entry. The CSS below it uses only those three. An unsorted ask sets them to the neutral values.
5. **The palette is data, in one module.** The eight hashtag colours live in one TypeScript module that also fills the tokens. The same module is what assigns a colour to a new hashtag.
6. **No styling library.** No utility framework, no component kit, no CSS written in JavaScript at run time.
7. **The font is served from the site.** It is installed as a package and bundled. The page makes no request to a font service.
8. **Phone first.** Base styles are for a 390px screen. Wider layouts are added with `min-width` queries.
9. **Icons are inline SVG** that take the text colour. There is no icon font and no icon package.
10. **Inline styles are only for values that are data,** such as the three hashtag properties.

## Alternatives considered

1. **A utility framework such as Tailwind.** It is fast to write and most agents know it well. Rejected: it adds a second vocabulary beside the tokens, it puts styling into the markup where it is hard to compare with the design, and data-driven colour fights its fixed class names. An implementer is likely to suggest this, so it becomes a "Do not" in the constraint file.
2. **A component kit.** It supplies buttons, tabs and dialogs ready made. Rejected: it brings its own look, and the work would become overriding it to match ten screens that are simpler than the kit.
3. **CSS written in JavaScript.** It makes data-driven styles easy. Rejected: it costs time on every render on a phone, and custom properties already carry the one piece of data that varies.
4. **One global stylesheet.** It is the least machinery. Rejected: with several agents adding parts, class names collide and nobody knows which rules are still used.
5. **A font service.** It is one line in the page. Rejected: it sends every visitor's address to a third party and adds a request before text can paint.

## Fitness functions

All five run in CI and block a merge.

| Check | What it asserts | What it catches |
| --- | --- | --- |
| Values come from tokens | No file under `web/` other than the tokens file and the palette module contains a colour literal, a font family or a pixel font size. | A value typed in by hand that drifts from the design. |
| The palette is readable | For every hashtag colour, white on the strong and the ink on the tint are at least 4.5 to 1. | A palette change that makes a button or a pill hard to read. |
| No styling library | `package.json` lists none of the known utility frameworks, component kits or run-time CSS libraries. | A library added for one convenient component. |
| No outside requests for style | The built page references no stylesheet or font on another host. | A font service or a hosted stylesheet creeping in. |
| Things can be tapped | In the browser tier, every button and link on the list and the open card is at least 44px by 44px. | A control too small for a thumb. |

## Consequences

**Easier**

- Changing a colour or a size is one edit, and the whole page follows.
- A pull request's styles can be read against [`docs/design.md`](../design.md) by name.
- The page ships no styling code that runs, and makes no third-party request.
- A hashtag's colour works the same in a tab, a card, a row and a button.

**Harder, and accepted**

- More to write by hand than with a utility framework or a kit.
- Dialogs, focus handling and swipes are built here, not borrowed, and need their own tests.
- The first check is a text search. It can be fooled by an odd spelling of a colour, and it needs an allowance for SVG paths.
- Whether a screen matches the design is still a judgement. No check sees it.
