import { createHash } from "node:crypto";
import {
  SendMessageBatchCommand,
  SQSClient,
  type SendMessageBatchRequestEntry,
} from "@aws-sdk/client-sqs";
import { z } from "zod";
import { awsClientConfig } from "./aws";
import type { AccountId } from "./identity";
import { errorClass, type Logger } from "./log";

// No rules version: the sort function reads the rules in force when the job
// runs.
export const sortJobSchema = z.strictObject({
  accountId: z.string(),
  askId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u),
});

// The most SQS takes in one call.
export const jobsPerCall = 10;

// So a save of every open ask never waits on the SDK's connection pool.
const callsAtOnce = 10;

// Retries included. The queue answers in milliseconds, so this is reached
// only when its API hangs.
export const sortRequestTimeoutMs = 1000;

// The group is the ask, so one ask's jobs never run at once. The
// deduplication id drops a retried send but lets a later post or save
// through. It is hashed because SQS takes at most 128 characters.
export function jobMessage(account: AccountId, askId: string, at: Date) {
  return {
    groupId: askId,
    deduplicationId: createHash("sha256")
      .update(JSON.stringify([account, askId, at.toISOString()]))
      .digest("hex"),
    text: JSON.stringify(sortJobSchema.parse({ accountId: account, askId })),
  };
}

export interface Untaken {
  askId: string;
  errorClass: string;
}

export interface SortRequests {
  // Answers the asks the queue did not take. Never throws.
  queue(
    account: AccountId,
    askIds: readonly string[],
    at: Date,
  ): Promise<Untaken[]>;
}

export function createSortRequests(config: {
  queueUrl: string;
  endpoint?: string | undefined;
}): SortRequests {
  const { queueUrl, endpoint } = config;
  // A retry resends the same messages, which the queue drops if it took
  // them.
  const client = new SQSClient({
    maxAttempts: 2,
    ...awsClientConfig(endpoint),
  });

  async function send(
    account: AccountId,
    askIds: readonly string[],
    at: Date,
  ): Promise<Untaken[]> {
    try {
      // Built inside the try, so a job that fails its schema is reported as
      // not taken and queueing never throws.
      const entries: SendMessageBatchRequestEntry[] = askIds.map(
        (askId, place) => {
          const { groupId, deduplicationId, text } = jobMessage(
            account,
            askId,
            at,
          );
          return {
            Id: String(place),
            MessageBody: text,
            MessageGroupId: groupId,
            MessageDeduplicationId: deduplicationId,
          };
        },
      );
      // Awaited, because Lambda freezes work left running after a handler
      // returns.
      const answer = await client.send(
        new SendMessageBatchCommand({ QueueUrl: queueUrl, Entries: entries }),
        { abortSignal: AbortSignal.timeout(sortRequestTimeoutMs) },
      );
      return (answer.Failed ?? []).map((failed) => ({
        askId: askIds[Number(failed.Id)] ?? "unknown",
        errorClass: failed.Code ?? "unknown",
      }));
    } catch (error) {
      return askIds.map((askId) => ({ askId, errorClass: errorClass(error) }));
    }
  }

  return {
    async queue(account, askIds, at) {
      const calls: string[][] = [];
      for (let start = 0; start < askIds.length; start += jobsPerCall) {
        calls.push(askIds.slice(start, start + jobsPerCall));
      }
      const untaken: Untaken[] = [];
      for (let start = 0; start < calls.length; start += callsAtOnce) {
        const answers = await Promise.all(
          calls
            .slice(start, start + callsAtOnce)
            .map((batch) => send(account, batch, at)),
        );
        untaken.push(...answers.flat());
      }
      return untaken;
    },
  };
}

export async function queueSorts(
  { sorts, log }: { sorts: SortRequests; log: Logger },
  account: AccountId,
  askIds: readonly string[],
  at: Date,
): Promise<void> {
  if (askIds.length === 0) return;
  for (const { askId, errorClass: reason } of await sorts.queue(
    account,
    askIds,
    at,
  )) {
    log.warn("sort-request-failed", {
      accountId: account,
      askId,
      errorClass: reason,
    });
  }
}
