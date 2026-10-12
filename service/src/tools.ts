// Every MCP tool is registered here, together with its schemas (ADR 10), and
// every refusal it makes follows the error contract (ADR 11).
import type {
  CallToolResult,
  McpServer,
  StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import type { z } from "zod";
import { refusal, Refused, retryBudget } from "./errors";
import { askScope, type Caller } from "./identity";
import type { SortRequests } from "./jobs";
import { createLogger, errorClass, type Logger } from "./log";
import type { Store } from "./store/store";

// What a tool works with: the store, and the sorter it hands new asks to.
export interface ToolServices {
  store: Store;
  sorts: SortRequests;
}

export interface ToolContext extends ToolServices {
  caller: Caller;
  log: Logger;
}

export interface ToolDefinition<
  Input extends z.ZodObject = z.ZodObject,
  Output extends z.ZodObject = z.ZodObject,
> {
  name: string;
  description: string;
  input: Input;
  output: Output;
  // The tool's answer, or a refusal it decided on as it ran.
  run(
    input: z.output<Input>,
    context: ToolContext,
  ): Promise<z.output<Output> | Refused>;
}

// The tool's own schema as the client sees it, with a check that lets every
// value through. The SDK would otherwise reject bad arguments in its own
// words, before the tool runs. The tool parses them with the same schema
// instead, and refuses them as invalid_input.
function advertised(schema: z.ZodObject): StandardSchemaWithJSON {
  return {
    "~standard": {
      version: 1,
      vendor: "askme",
      validate: (value: unknown) => ({ value }),
      jsonSchema: schema["~standard"].jsonSchema,
    },
  };
}

// The problems with some arguments, one per field, in the schema's words.
// It names fields and limits only, never the values sent.
function problems(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const field = issue.path.map(String).join(".");
      const keys =
        issue.code === "unrecognized_keys" ? issue.keys.join(", ") : "";
      if (keys !== "") return `${keys}: not a field of this tool`;
      return field === "" ? issue.message : `${field}: ${issue.message}`;
    })
    .join("; ");
}

export function addTool<Input extends z.ZodObject, Output extends z.ZodObject>(
  server: McpServer,
  tool: ToolDefinition<Input, Output>,
  caller: Caller,
  services: ToolServices,
): void {
  const log = createLogger(caller.requestId);
  const at = { accountId: caller.accountId, tool: tool.name };
  // eslint-disable-next-line no-restricted-properties -- this wrapper is the one place a tool is registered
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: advertised(tool.input),
      outputSchema: tool.output,
    },
    async (args): Promise<CallToolResult> => {
      if (!caller.scopes.includes(askScope)) {
        log.info("scope-missing", at);
        return refusal(
          "insufficient_scope",
          `This connection to askme is not allowed to post or resolve asks: its token lacks the ${askScope} scope. Do not retry. Tell the person that askme needs its connection approved again, and ask your question in your own session meanwhile.`,
        );
      }
      const parsed = tool.input.safeParse(args);
      if (!parsed.success) {
        log.info("input-invalid", at);
        return refusal(
          "invalid_input",
          `The call was not accepted. Fix these fields and send it again: ${problems(parsed.error)}.`,
        );
      }
      try {
        const answer = await tool.run(parsed.data, {
          caller,
          log,
          ...services,
        });
        if (answer instanceof Refused) {
          return refusal(answer.code, answer.message);
        }
        // The answer is parsed by the tool's own schema here, so one that
        // breaks it is a failure under the error contract, not the SDK's
        // own error text.
        const output = tool.output.parse(answer);
        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        };
      } catch (error) {
        log.error("request-failed", { ...at, errorClass: errorClass(error) });
        return refusal(
          "service_unavailable",
          `askme could not finish this call. Send the same call again, at most ${String(retryBudget)} times in all, then carry on without askme.`,
        );
      }
    },
  );
}
