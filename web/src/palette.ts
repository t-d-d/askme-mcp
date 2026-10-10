import type { CSSProperties } from "react";

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

export type HashtagColour = (typeof palette)[keyof typeof palette];

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
