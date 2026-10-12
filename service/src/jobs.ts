// Work the service hands on, to run after it has answered (PRD, "Back
// end"): an ask is never held up by sorting. The sort function is invoked
// asynchronously, so the call returns as soon as Lambda has queued it, and
// posting never waits on the model.
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { z } from "zod";
import type { AccountId } from "./identity";

// What the sort function is given: the account the token check gave, and
// the id of one of its asks.
export const sortJobSchema = z.strictObject({
  accountId: z.string(),
  askId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u),
});

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
  // Lambda answers an asynchronous invoke at once. A call that hangs is cut
  // short, so posting is never held up by it either.
  const shared = {
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 1000, requestTimeout: 2000 },
  };
  // In production the client finds its region and credentials in Lambda's
  // environment. The fake Lambda of the tests accepts any.
  const client = new LambdaClient(
    endpoint === undefined
      ? shared
      : {
          ...shared,
          endpoint,
          region: "us-east-1",
          credentials: { accessKeyId: "local", secretAccessKey: "local" },
        },
  );
  return {
    async request(job) {
      const answer = await client.send(
        new InvokeCommand({
          FunctionName: functionName,
          InvocationType: "Event",
          Payload: new TextEncoder().encode(JSON.stringify(job)),
        }),
      );
      if (answer.StatusCode !== 202) {
        throw new Error("Lambda did not queue the sort.");
      }
    },
  };
}
