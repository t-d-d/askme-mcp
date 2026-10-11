// What the live tier's files share: the deployed site's addresses, from the
// variables the deploy workflow sets, and the phone the page is opened on.
// An address is read when a test asks for it, so a missing one fails that
// test with its message.
import { z } from "zod";

export const phone = { width: 390, height: 844 };

const https = z.url({ protocol: /^https$/u });

const address = (name: string, what: string) => (): string =>
  https.parse(process.env[name], { error: () => `Set ${name} to ${what}.` });

// The page, which also takes its API's calls on its own address.
export const pageUrl = address("ASKME_URL", "the live address");
export const mcpUrl = address("ASKME_MCP_URL", "the live MCP endpoint");
export const clerkIssuer = address(
  "CLERK_ISSUER",
  "the Clerk issuer the service uses",
);
