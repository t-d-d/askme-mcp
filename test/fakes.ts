// Stand-ins on loopback for the services the sorting path reaches (ADR 9):
// the model, faked at the HTTP edge with recorded replies, Parameter
// Store, which holds the model's key, and Lambda, which takes the asks
// handed to the sort function.
//
// The integration tier starts one set for each test file, in
// test/service-env.ts, and points the service at them. A test imports
// `fakes` from here to give the model its replies and to run the sorts
// that were handed on.
import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";

// The key Parameter Store gives the service, and the parameter it is under.
export const testModelKey = "test-model-key";
export const modelKeyParameter = "/askme/openrouter/api-key";

// The function the service hands asks to.
export const sortFunction = "askme-prod-sort";

// What the model is to answer next: a reply, given as the JSON it holds or
// as raw text, or a failure with only a status.
export type ModelReply =
  { json: unknown } | { text: string } | { status: number };

export interface ModelCall {
  authorization: string | null;
  body: unknown;
}

export interface FakeModel {
  // OpenRouter's API address, in place of https://openrouter.ai/api/v1.
  endpoint: string;
  calls: ModelCall[];
  // Queues replies, answered in order. With none queued, the model fails
  // with a 503.
  reply(...replies: ModelReply[]): void;
}

export interface Invocation {
  functionName: string;
  invocationType: string | null;
  payload: unknown;
}

export interface FakeLambda {
  endpoint: string;
  // Every invoke, in order, whether or not it has run.
  invoked: Invocation[];
  // When set, Lambda refuses every invoke with a server error.
  failing: boolean;
  // Runs each invoke not yet run through a handler, as Lambda would after
  // the call that queued it has answered. Gives how many it ran.
  drain(run: (payload: unknown) => Promise<void>): Promise<number>;
}

export interface FakeParameterStore {
  endpoint: string;
  // The name of each parameter asked for.
  asked: string[];
}

export interface Fakes {
  model: FakeModel;
  lambda: FakeLambda;
  parameters: FakeParameterStore;
  close(): Promise<void>;
}

// OpenRouter's answer to a chat completion, recorded from its API, with the
// model's reply as the message's content.
const completion = (content: string) => ({
  id: "gen-1760000000-abcdefghijklmnopqrst",
  provider: "Google",
  model: "anthropic/claude-haiku-5.5",
  object: "chat.completion",
  created: 1_760_000_000,
  choices: [
    {
      logprobs: null,
      finish_reason: "stop",
      native_finish_reason: "end_turn",
      index: 0,
      message: { role: "assistant", content, refusal: null, reasoning: null },
    },
  ],
  usage: { prompt_tokens: 512, completion_tokens: 38, total_tokens: 550 },
});

async function bodyOf(incoming: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

async function listen(
  serve: (incoming: IncomingMessage, outgoing: ServerResponse) => Promise<void>,
) {
  const server = createServer((incoming, outgoing) => {
    serve(incoming, outgoing).catch(() => {
      outgoing.statusCode = 500;
      outgoing.end();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = z
    .object({ port: z.number() })
    .parse(server.address() satisfies AddressInfo | string | null);
  return {
    address: `http://127.0.0.1:${String(port)}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

function send(outgoing: ServerResponse, status: number, body?: unknown) {
  outgoing.statusCode = status;
  if (body === undefined) {
    outgoing.end();
    return;
  }
  outgoing.setHeader("content-type", "application/json");
  outgoing.end(JSON.stringify(body));
}

async function startModel() {
  const calls: ModelCall[] = [];
  const queued: ModelReply[] = [];
  const server = await listen(async (incoming, outgoing) => {
    const body = parsed(await bodyOf(incoming));
    if (
      incoming.method !== "POST" ||
      incoming.url !== "/api/v1/chat/completions"
    ) {
      send(outgoing, 404);
      return;
    }
    calls.push({
      authorization: incoming.headers.authorization ?? null,
      body,
    });
    const next = queued.shift() ?? { status: 503 };
    if ("status" in next) {
      send(outgoing, next.status, { error: { code: next.status } });
    } else {
      const content = "json" in next ? JSON.stringify(next.json) : next.text;
      send(outgoing, 200, completion(content));
    }
  });
  const model: FakeModel = {
    endpoint: `${server.address}/api/v1`,
    calls,
    reply: (...replies) => {
      queued.push(...replies);
    },
  };
  return { model, close: server.close };
}

// Lambda's Invoke call, as the SDK sends it.
const invokePath = /^\/2015-03-31\/functions\/([^/]+)\/invocations$/u;

async function startLambda() {
  const invoked: Invocation[] = [];
  let ran = 0;
  const lambda: FakeLambda = {
    endpoint: "",
    invoked,
    failing: false,
    async drain(run) {
      let count = 0;
      while (ran < invoked.length) {
        const next = invoked[ran];
        ran += 1;
        if (next !== undefined) {
          await run(next.payload);
          count += 1;
        }
      }
      return count;
    },
  };
  const server = await listen(async (incoming, outgoing) => {
    const body = await bodyOf(incoming);
    const name = invokePath.exec(incoming.url ?? "")?.[1];
    if (incoming.method !== "POST" || name === undefined) {
      send(outgoing, 404);
      return;
    }
    if (lambda.failing) {
      send(outgoing, 500, { Type: "Service", message: "Lambda is down." });
      return;
    }
    const type = incoming.headers["x-amz-invocation-type"];
    invoked.push({
      functionName: decodeURIComponent(name),
      invocationType: typeof type === "string" ? type : null,
      payload: parsed(body),
    });
    send(outgoing, 202);
  });
  lambda.endpoint = server.address;
  return { lambda, close: server.close };
}

async function startParameterStore() {
  const asked: string[] = [];
  const server = await listen(async (incoming, outgoing) => {
    const body = z
      .object({ Name: z.string() })
      .safeParse(parsed(await bodyOf(incoming)));
    if (
      incoming.headers["x-amz-target"] !== "AmazonSSM.GetParameter" ||
      !body.success
    ) {
      send(outgoing, 400, { __type: "ValidationException" });
      return;
    }
    asked.push(body.data.Name);
    outgoing.setHeader("content-type", "application/x-amz-json-1.1");
    if (body.data.Name !== modelKeyParameter) {
      outgoing.statusCode = 400;
      outgoing.end(
        JSON.stringify({ __type: "ParameterNotFound", message: "Not found." }),
      );
      return;
    }
    outgoing.statusCode = 200;
    outgoing.end(
      JSON.stringify({
        Parameter: {
          Name: modelKeyParameter,
          Type: "SecureString",
          Value: testModelKey,
          Version: 1,
          DataType: "text",
        },
      }),
    );
  });
  return {
    parameters: { endpoint: server.address, asked },
    close: server.close,
  };
}

export async function startFakes(): Promise<Fakes> {
  const [model, lambda, parameters] = await Promise.all([
    startModel(),
    startLambda(),
    startParameterStore(),
  ]);
  return {
    model: model.model,
    lambda: lambda.lambda,
    parameters: parameters.parameters,
    close: async () => {
      await Promise.all([model.close(), lambda.close(), parameters.close()]);
    },
  };
}

// The set for the test file that imports this module. test/service-env.ts
// starts it before the file's tests, and the file's tests share it.
export const fakes: Fakes = await startFakes();
