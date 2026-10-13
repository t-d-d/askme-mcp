// Stand-ins on loopback for the services the sorting path reaches (ADR 9):
// the model, faked at the HTTP edge with recorded replies, Parameter
// Store, which holds the model's key, and the queue, which takes the sort
// jobs for the sort function.
//
// The integration tier starts one set for each test file, in
// test/service-env.ts, and points the service at them. A test imports
// `fakes` from here to give the model its replies and to deliver the jobs
// that were queued.
import { createHash, randomUUID } from "node:crypto";
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

// The queue the service sends sort jobs to.
export const sortQueueName = "askme-sort.fifo";

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

// A message sent to the queue: its group, its deduplication id, its body,
// and whether the queue took it or dropped it as a repeat of one it took in
// the last five minutes.
export interface SentMessage {
  groupId: string;
  deduplicationId: string;
  body: unknown;
  taken: boolean;
}

export interface FakeQueue {
  endpoint: string;
  // The queue's address, which the service sends to.
  url: string;
  // Every message sent, in order, whether or not the queue took it.
  sent: SentMessage[];
  // How many messages each call the queue answered held, in order.
  calls: number[];
  // When set, the queue refuses every call with a server error.
  failing: boolean;
  // When set, the queue takes each call and never answers it.
  hanging: boolean;
  // When set, the queue answers each call, and takes none of its messages.
  refusing: boolean;
  // Takes the next calls' messages, then answers each with a server error,
  // as when an answer is lost on its way back, so the SDK sends it again.
  loseAnswers(count: number): void;
  // How many messages wait to be delivered.
  waiting(): number;
  // Deletes every waiting message, as SQS's purge does.
  purge(): void;
  // Delivers each waiting message through a handler, one per run, as
  // Lambda's trigger would after the call that sent it has answered. A
  // message the run reports as failed, or whose run throws, waits for the
  // next call, as SQS hides it for its visibility timeout, and holds back
  // the later messages of its group until then. Any other is deleted. Gives
  // how many runs it made.
  deliver(run: (event: unknown) => Promise<unknown>): Promise<number>;
}

export interface FakeParameterStore {
  endpoint: string;
  // The name of each parameter asked for.
  asked: string[];
  // When set, Parameter Store takes each call and never answers it.
  hanging: boolean;
}

export interface Fakes {
  model: FakeModel;
  queue: FakeQueue;
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

// SQS's JSON protocol: one POST to the endpoint, which names its action in
// a header.
const sqsTarget = "AmazonSQS.SendMessageBatch";
const sqsJson = "application/x-amz-json-1.0";

// What SQS takes in a group or deduplication id: up to 128 letters, digits
// and punctuation.
const sqsId = /^[\w!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~-]{1,128}$/u;

// SQS drops a message whose deduplication id it took in the last five
// minutes, and still answers that it took it.
const dedupeMs = 5 * 60_000;

const batchSchema = z.object({
  QueueUrl: z.string(),
  Entries: z
    .array(
      z.object({
        Id: z.string(),
        MessageBody: z.string().min(1),
        MessageGroupId: z.string().regex(sqsId),
        MessageDeduplicationId: z.string().regex(sqsId),
      }),
    )
    .min(1)
    .max(10)
    .refine(
      (entries) => new Set(entries.map(({ Id }) => Id)).size === entries.length,
    ),
});

// What the sort function answers for a run: the messages it reports as
// failed. An answer of nothing reports none.
const runAnswer = z
  .object({
    batchItemFailures: z.array(z.object({ itemIdentifier: z.string() })),
  })
  .optional();

interface Waiting {
  messageId: string;
  groupId: string;
  deduplicationId: string;
  body: string;
  sentAt: number;
  sequenceNumber: string;
  receives: number;
}

function sqsError(outgoing: ServerResponse, status: number, type: string) {
  outgoing.statusCode = status;
  outgoing.setHeader("content-type", sqsJson);
  outgoing.end(
    JSON.stringify({ __type: `com.amazonaws.sqs#${type}`, message: type }),
  );
}

async function startQueue() {
  const sent: SentMessage[] = [];
  const calls: number[] = [];
  const waiting: Waiting[] = [];
  const taken = new Map<string, number>();
  let lost = 0;
  let sequence = 0;
  const queue: FakeQueue = {
    endpoint: "",
    url: "",
    sent,
    calls,
    failing: false,
    hanging: false,
    refusing: false,
    loseAnswers(count) {
      lost = count;
    },
    waiting: () => waiting.length,
    purge() {
      waiting.length = 0;
    },
    async deliver(run) {
      let runs = 0;
      // A group whose message failed in this call waits for the next one.
      const held = new Set<string>();
      for (;;) {
        const next = waiting.find(({ groupId }) => !held.has(groupId));
        if (next === undefined) return runs;
        next.receives += 1;
        runs += 1;
        let failed: boolean;
        try {
          const answer = runAnswer.parse(
            await run({
              Records: [
                {
                  messageId: next.messageId,
                  receiptHandle: `${next.messageId}-${String(next.receives)}`,
                  body: next.body,
                  attributes: {
                    ApproximateReceiveCount: String(next.receives),
                    SentTimestamp: String(next.sentAt),
                    SequenceNumber: next.sequenceNumber,
                    MessageGroupId: next.groupId,
                    SenderId: "AROAEXAMPLE:askme-prod-mcp",
                    MessageDeduplicationId: next.deduplicationId,
                    ApproximateFirstReceiveTimestamp: String(next.sentAt),
                  },
                  messageAttributes: {},
                  md5OfBody: createHash("md5").update(next.body).digest("hex"),
                  eventSource: "aws:sqs",
                  eventSourceARN: `arn:aws:sqs:us-east-1:000000000000:${sortQueueName}`,
                  awsRegion: "us-east-1",
                },
              ],
            }),
          );
          failed = (answer?.batchItemFailures ?? []).some(
            ({ itemIdentifier }) => itemIdentifier === next.messageId,
          );
        } catch {
          // A run that throws fails, and Lambda leaves its message.
          failed = true;
        }
        if (failed) {
          held.add(next.groupId);
        } else {
          waiting.splice(waiting.indexOf(next), 1);
        }
      }
    },
  };
  const server = await listen(async (incoming, outgoing) => {
    const body = parsed(await bodyOf(incoming));
    if (
      incoming.method !== "POST" ||
      incoming.headers["x-amz-target"] !== sqsTarget
    ) {
      sqsError(outgoing, 400, "InvalidAction");
      return;
    }
    if (queue.failing) {
      sqsError(outgoing, 500, "InternalError");
      return;
    }
    if (queue.hanging) return;
    const batch = batchSchema.safeParse(body);
    if (!batch.success) {
      sqsError(outgoing, 400, "InvalidParameterValue");
      return;
    }
    if (batch.data.QueueUrl !== queue.url) {
      sqsError(outgoing, 400, "QueueDoesNotExist");
      return;
    }
    const { Entries: entries } = batch.data;
    calls.push(entries.length);
    if (queue.refusing) {
      outgoing.setHeader("content-type", sqsJson);
      outgoing.end(
        JSON.stringify({
          Successful: [],
          Failed: entries.map(({ Id }) => ({
            Id,
            SenderFault: false,
            Code: "InternalError",
            Message: "The queue did not take it.",
          })),
        }),
      );
      return;
    }
    const now = Date.now();
    const successful = entries.map((entry) => {
      const deduplicationId = entry.MessageDeduplicationId;
      const first = taken.get(deduplicationId);
      const repeat = first !== undefined && now - first < dedupeMs;
      sent.push({
        groupId: entry.MessageGroupId,
        deduplicationId,
        body: parsed(entry.MessageBody),
        taken: !repeat,
      });
      const messageId = randomUUID();
      sequence += 1;
      const sequenceNumber = String(sequence).padStart(20, "0");
      if (!repeat) {
        taken.set(deduplicationId, now);
        waiting.push({
          messageId,
          groupId: entry.MessageGroupId,
          deduplicationId,
          body: entry.MessageBody,
          sentAt: now,
          sequenceNumber,
          receives: 0,
        });
      }
      return {
        Id: entry.Id,
        MessageId: messageId,
        MD5OfMessageBody: createHash("md5")
          .update(entry.MessageBody)
          .digest("hex"),
        SequenceNumber: sequenceNumber,
      };
    });
    if (lost > 0) {
      lost -= 1;
      sqsError(outgoing, 500, "InternalError");
      return;
    }
    outgoing.setHeader("content-type", sqsJson);
    outgoing.end(JSON.stringify({ Successful: successful, Failed: [] }));
  });
  queue.endpoint = server.address;
  queue.url = `${server.address}/000000000000/${sortQueueName}`;
  return { queue, close: server.close };
}

async function startParameterStore() {
  const parameters: FakeParameterStore = {
    endpoint: "",
    asked: [],
    hanging: false,
  };
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
    parameters.asked.push(body.data.Name);
    if (parameters.hanging) return;
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
  parameters.endpoint = server.address;
  return { parameters, close: server.close };
}

export async function startFakes(): Promise<Fakes> {
  const [model, queue, parameters] = await Promise.all([
    startModel(),
    startQueue(),
    startParameterStore(),
  ]);
  return {
    model: model.model,
    queue: queue.queue,
    parameters: parameters.parameters,
    close: async () => {
      await Promise.all([model.close(), queue.close(), parameters.close()]);
    },
  };
}

// The set for the test file that imports this module. test/service-env.ts
// starts it before the file's tests, and the file's tests share it.
export const fakes: Fakes = await startFakes();
