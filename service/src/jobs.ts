// Work the service hands on, to run after it has answered (PRD, "Back
// end"): an ask is never held up by sorting. Each sort is a job on one FIFO
// queue, the sort function's only trigger (ADR 22). Posting an ask queues
// one, and saving the rules queues one for each open ask, or for each ask
// still behind the rules when the text is unchanged. Nothing else queues a
// job. The queue delivers a failed sort again, whether or not a page is
// open, so a poll never starts one.
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

// What a job holds: the account the token check gave, and the id of one of
// its asks. The sort function reads the rules in force when the job runs,
// so a job carries no rules version.
export const sortJobSchema = z.strictObject({
  accountId: z.string(),
  askId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u),
});

// How many jobs one call to the queue sends, which is the most SQS takes.
export const jobsPerCall = 10;

// How many calls to the queue are under way at once, so a save of every
// open ask never waits on the SDK's pool of connections.
const callsAtOnce = 10;

// How long one call to the queue may take in all, retries included. The
// queue answers in milliseconds, so this is reached only when its API
// hangs, and then a post or a save waits no longer than this for it.
export const sortRequestTimeoutMs = 1000;

// One job as the queue takes it. Its group is the ask, so the queue runs one
// ask's jobs one after another, never at once. Its deduplication id is the
// account, the ask and the time of the post or save that queued it: a send
// repeated by a retry is dropped, and a later post or save always gets
// through. The three are hashed because SQS takes at most 128 characters,
// and an account and an ask may come to more.
export function jobMessage(account: AccountId, askId: string, at: Date) {
  return {
    groupId: askId,
    deduplicationId: createHash("sha256")
      .update(JSON.stringify([account, askId, at.toISOString()]))
      .digest("hex"),
    text: JSON.stringify(sortJobSchema.parse({ accountId: account, askId })),
  };
}

// An ask the queue did not take, and why.
export interface Untaken {
  askId: string;
  errorClass: string;
}

export interface SortRequests {
  // Queues a sort of each of an account's asks, for the post or save made
  // at a moment, ten to a call. Gives the asks the queue did not take. It
  // never throws.
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
  // A failure the queue answers at once is tried again, within the time
  // limit, with the same messages, which the queue drops if it took them.
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
      // not taken, like any other, and queueing never throws.
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
      // The caller still waits for the call, because Lambda freezes work
      // left running after a handler returns. A call that hangs is cut
      // short instead, so posting is never held up by it either.
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

// Queues a sort of each ask, and logs each one the queue did not take at
// warn. The ask keeps what it has, unsorted or its old sort, and shows as
// stopped once its time is up, when a save of the rules queues it again.
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
