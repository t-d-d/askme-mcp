// The test tiers of ADR 9, with conformance from ADR 15. A test's file suffix
// fixes its tier, and the tier fixes what the test may touch. Live runs after
// each deploy, conformance every day, and the rest in the gate.
export const tiers = [
  { name: "static", suffix: ".static.ts", inGate: true },
  { name: "unit", suffix: ".test.ts", inGate: true },
  { name: "int", suffix: ".int.ts", inGate: true },
  { name: "browser", suffix: ".browser.ts", inGate: true },
  { name: "live", suffix: ".live.ts", inGate: false },
  { name: "conformance", suffix: ".conformance.ts", inGate: false },
] as const;

export type Tier = (typeof tiers)[number];

export function tierPattern(tier: Tier): string {
  return `**/*${tier.suffix}`;
}
