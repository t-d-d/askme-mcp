import type { CSSProperties } from "react";
import type { Hashtag } from "../../shared/page-api";
import { shownUnder, type Tab } from "./tab";

// In the order new hashtags take them (docs/design.md). White on each
// strong, and each ink on its tint, has a contrast of at least 4.5 to 1.
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

export const unsorted: HashtagColour = {
  strong: "var(--text-2)",
  tint: "var(--neutral-tint)",
  ink: "var(--text-2)",
};

export const neutral: HashtagColour = {
  strong: "var(--ink)",
  tint: "var(--neutral-tint)",
  ink: "var(--ink)",
};

const inOrder: readonly HashtagColour[] = Object.values(palette);

// place is where the hashtag first appeared in the account's rules, as the
// service numbers it, so a hashtag keeps its colour.
export function colourOf(place: number): HashtagColour {
  return inOrder[place % inOrder.length] ?? neutral;
}

export function hashtagColours(
  hashtags: readonly Hashtag[],
): ReadonlyMap<string, HashtagColour> {
  return new Map(hashtags.map(({ name, colour }) => [name, colourOf(colour)]));
}

export function askColour(
  sort: { hashtags: readonly string[] } | null,
  tab: Tab,
  colours: ReadonlyMap<string, HashtagColour>,
): HashtagColour {
  if (sort === null) return unsorted;
  const shown = shownUnder(sort, tab);
  return (shown === undefined ? undefined : colours.get(shown)) ?? neutral;
}

// The only custom properties an inline style may set (ADR 14).
declare module "react" {
  interface CSSProperties {
    "--tag-strong"?: string;
    "--tag-tint"?: string;
    "--tag-ink"?: string;
  }
}

export function tagColour(colour: HashtagColour): CSSProperties {
  return {
    "--tag-strong": colour.strong,
    "--tag-tint": colour.tint,
    "--tag-ink": colour.ink,
  };
}
