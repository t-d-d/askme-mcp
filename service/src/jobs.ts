// Work the service hands on, to run after it has answered (PRD, "Back
// end"): an ask is never held up by sorting. The sort function is invoked
// asynchronously, so the call returns as soon as Lambda has queued it, and
// posting never waits on the model.
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { z } from "zod";
import { awsClientConfig } from "./aws";
import type { AccountId } from "./identity";

// What the sort function is given: the account the token check gave, and
// the id of one of its asks.
export const sortJobSchema = z.strictObject({
  accountId: z.string(),
  askId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u),
});

// How long handing one ask on may take in all, retries included. Lambda
// answers an asynchronous invoke at once, so this is reached only when its
// API hangs, and then a post or a poll waits no longer than this.
export const sortRequestTimeoutMs = 1000;

export interface SortJob {
  accountId: AccountId;
  askId: string;
}

export interface SortRequests {
  // Hands one ask to the sort function. It throws when Lambda did not take
  // it.
  request(job: SortJob): Promise<void>;
}

export function createSortRequests(config: {
  functionName: string;
  endpoint?: string | undefined;
}): SortRequests {
  const { functionName, endpoint } = config;
  // A failure Lambda answers at once is tried again, within the time limit.
  const client = new LambdaClient({
    maxAttempts: 2,
    ...awsClientConfig(endpoint),
  });
  return {
    async request(job) {
      // The caller still waits for the call, because Lambda freezes work
      // left running after a handler returns. A call that hangs is cut short
      // instead, so posting is never held up by it either.
      const answer = await client.send(
        new InvokeCommand({
          FunctionName: functionName,
          InvocationType: "Event",
          Payload: new TextEncoder().encode(JSON.stringify(job)),
        }),
        { abortSignal: AbortSignal.timeout(sortRequestTimeoutMs) },
      );
      if (answer.StatusCode !== 202) {
        throw new Error("Lambda did not queue the sort.");
      }
    },
  };
}
