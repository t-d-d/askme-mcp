# Styling
Relevance: Any change to how the page looks, a new component, a new colour or size, or a styling dependency: web/**/*.css, web/src/tokens.css, the palette module, web/**/*.tsx, package.json
Decision: Plain CSS from one tokens file, a CSS Module per component, hashtag colour set as three custom properties, no styling library.

Why: The design is small and exact, and agents build the page one
issue at a time. One source of values is what keeps every part
matching docs/design.md.

## Rules

- Every colour, font, size, radius and space is a custom property
  declared in web/src/tokens.css, named as in docs/design.md.
- No other file holds a colour literal, a font name or a pixel font
  size.
- Each component has its own CSS Module.
- A hashtag's colour reaches CSS as --tag-strong, --tag-tint and
  --tag-ink, set on the element. An unsorted ask sets the neutral
  values.
- The eight hashtag colours live in one module, which also assigns a
  colour to a new hashtag.
- The font is bundled with the site.
- Base styles are for a phone. Wider layouts use min-width queries.
- Icons are inline SVG in the text colour.
- Anything that can be tapped is at least 44px by 44px.

## Do not

- Add a utility framework such as Tailwind: a second vocabulary
  beside the tokens, and it fights data-driven colour.
- Add a component kit: it brings its own look.
- Write CSS in JavaScript at run time.
- Load a font or a stylesheet from another host.
- Put a colour in an inline style, other than the three hashtag
  properties.
- Add a colour to the palette without its contrast check passing.

Judgment: Whether a screen matches docs/design.md and the mockup is
checked by eye, at phone width, before a push. No test sees it.

History: [ADR 14](../adr/0014-styling.md)
