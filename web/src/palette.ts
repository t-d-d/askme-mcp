import type { CSSProperties } from "react";
import type { Hashtag } from "../../shared/page-api";

// The eight hashtag colours of docs/design.md, in the order new hashtags take
// them. White on every strong, and each ink on its tint, is at least 4.5 to 1.
export const palette = {
  blue: { strong: "#1F3BB3", tint: "#DCE4FF", ink: "#1B3399" },
  orange: { strong: "#B8460B", tint: "#FFE2CC", ink: "#8A3A08" },
  purple: { strong: "#6D3BB5", tint: "#E9DDF8", ink: "#54298F" },
  teal: { strong: "#0B6F6A", tint: "#D3EFEC", ink: "#0A5450" },
  magenta: { strong: "#A8246E", tint: "#FBDCEC", ink: "#861B57" },
  olive: { strong: "#5E6B12", tint: "#E7ECC4", ink: "#48520D" },
  sky: { strong: "#0E6A8F", tint: "#D5ECF6", ink: "#0B526E" },
  gold: { strong: "#8A5A00", tint: "#F6E4BF", ink: "#6B4600" },
} as const;

export interface HashtagColour {
  strong: string;
  tint: string;
  ink: string;
}

// An ask that is not sorted yet has no colour (docs/design.md): its main
// button is --text-2, and its pill and second button --neutral-tint.
export const unsorted: HashtagColour = {
  strong: "var(--text-2)",
  tint: "var(--neutral-tint)",
  ink: "var(--text-2)",
};

// An ask sorted into none of the account's hashtags belongs to no part of
// the person's life, so it is neutral, in ink (docs/design.md, "Colour
// rules").
export const neutral: HashtagColour = {
  strong: "var(--ink)",
  tint: "var(--neutral-tint)",
  ink: "var(--ink)",
};

const inOrder: readonly HashtagColour[] = Object.values(palette);

// A hashtag takes the next colour in the table when it first appears, and
// keeps it. The service numbers each hashtag by the place it first appeared
// in the account's rules. A ninth hashtag starts the table again.
export function colourOf(place: number): HashtagColour {
  return inOrder[place % inOrder.length] ?? neutral;
}

// The colour of each of the account's hashtags, by name.
export function hashtagColours(
  hashtags: readonly Hashtag[],
): ReadonlyMap<string, HashtagColour> {
  return new Map(hashtags.map(({ name, colour }) => [name, colourOf(colour)]));
}

// A sorted ask takes the colour of its first hashtag, in the rules' order.
export function sortedColour(
  sort: { hashtags: readonly string[] },
  colours: ReadonlyMap<string, HashtagColour>,
): HashtagColour {
  const [first] = sort.hashtags;
  return (first === undefined ? undefined : colours.get(first)) ?? neutral;
}

// The only custom properties an inline style may set (ADR 14).
declare module "react" {
  interface CSSProperties {
    "--tag-strong"?: string;
    "--tag-tint"?: string;
    "--tag-ink"?: string;
  }
}

// The inline style that gives an element, and what it holds, a hashtag's colour.
export function tagColour(colour: HashtagColour): CSSProperties {
  return {
    "--tag-strong": colour.strong,
    "--tag-tint": colour.tint,
    "--tag-ink": colour.ink,
  };
}
