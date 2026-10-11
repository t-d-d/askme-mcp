// Connects the official MCP client to the service's Lambda handler, in
// process (ADR 9). Requests go through the handler as API Gateway would send
// them, so the token check, the routing and the MCP server all run.
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { z } from "zod";
import { handlerFetch, type LambdaHandler } from "./lambda";

// The address the tests give the deployed API. Nothing resolves it: every
// request goes to the handler.
export const origin = "https://askme.test";
export const mcpUrl = `${origin}/mcp`;
export const metadataUrl = `${origin}/.well-known/oauth-protected-resource/mcp`;

// legacy is the 2025 handshake that Claude and Cursor use today. modern is
// the 2026-07-28 revision, which the SDK negotiates when asked to.
export type Era = "legacy" | "modern";
export const eras: Era[] = ["legacy", "modern"];

export async function connect(
  handler: LambdaHandler,
  options: { token?: string; era?: Era; seen?: Response[] } = {},
): Promise<Client> {
  const client = new Client(
    { name: "askme-test", version: "1.0.0" },
    options.era === "modern" ? { versionNegotiation: { mode: "auto" } } : {},
  );
  const headers: Record<string, string> =
    options.token === undefined
      ? {}
      : { authorization: `Bearer ${options.token}` };
  await client.connect(
    new StreamableHTTPClientTransport(new URL(mcpUrl), {
      fetch: handlerFetch(handler, options.seen),
      requestInit: { headers },
    }),
  );
  return client;
}

// A refusal as the model reads it: the text of a result marked as an error.
const refusalSchema = z.object({
  code: z.string(),
  class: z.enum(["retry", "do not retry"]),
  message: z.string(),
});

const resultSchema = z.object({
  isError: z.literal(true),
  content: z.tuple([z.object({ type: z.literal("text"), text: z.string() })]),
});

export function refusalOf(result: unknown): z.infer<typeof refusalSchema> {
  const { content } = resultSchema.parse(result);
  return refusalSchema.parse(JSON.parse(content[0].text));
}
