// The page's API: its routes, and what each one answers. The service builds
// its answers with these schemas and the page parses them with the same
// ones, so the two cannot drift apart while neither imports the other
// (ADR 10).
import { z } from "zod";

export const pagePaths = {
  asks: "/api/asks",
  connection: "/api/connection",
} as const;

// The account's open asks, the version they were read at, and whether the
// account has ever had an ask, which tells a new account from one that is
// all clear.
export const asksAnswer = z.object({
  version: z.number().int().nonnegative(),
  everAsked: z.boolean(),
  asks: z.array(
    z.object({
      id: z.string(),
      summary: z.string(),
      spokenDetail: z.string(),
      postedAt: z.iso.datetime(),
    }),
  ),
});

export type AsksAnswer = z.infer<typeof asksAnswer>;
export type PageAsk = AsksAnswer["asks"][number];

// What the page needs to help someone connect an agent.
export const connectionAnswer = z.object({
  mcpUrl: z.url({ protocol: /^https$/u }),
});

export type ConnectionAnswer = z.infer<typeof connectionAnswer>;
