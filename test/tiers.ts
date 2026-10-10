// The five test tiers of ADR 9. A test's file suffix fixes its tier, and the
// tier fixes what the test may touch. Every tier but live runs in the gate.
export const tiers = [
  { name: "static", suffix: ".static.ts", inGate: true },
  { name: "unit", suffix: ".test.ts", inGate: true },
  { name: "int", suffix: ".int.ts", inGate: true },
  { name: "browser", suffix: ".browser.ts", inGate: true },
  { name: "live", suffix: ".live.ts", inGate: false },
] as const;

export type Tier = (typeof tiers)[number];

export function tierPattern(tier: Tier): string {
  return `**/*${tier.suffix}`;
}
