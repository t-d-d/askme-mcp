// The service's own key for the model, read from Parameter Store, where issue
// #1 put it as a SecureString. It is read on first use and kept for the life
// of the function, so it is never in the deployment definition or the
// function's settings.
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { z } from "zod";
import { awsClientConfig } from "./aws";

// How long one read of the key may take in all, retries included. A read
// that runs out is not kept, so the next call asks again rather than wait
// on a Parameter Store that never answered.
export const keyReadTimeoutMs = 2000;

const answerSchema = z.object({
  Parameter: z.object({ Value: z.string().min(1) }),
});

export function createKeyReader(config: {
  parameter: string;
  endpoint?: string | undefined;
}): () => Promise<string> {
  const { parameter, endpoint } = config;
  const client = new SSMClient(awsClientConfig(endpoint));
  let key: Promise<string> | undefined;
  return () => {
    key ??= client
      .send(
        new GetParameterCommand({ Name: parameter, WithDecryption: true }),
        { abortSignal: AbortSignal.timeout(keyReadTimeoutMs) },
      )
      .then((answer) => answerSchema.parse(answer).Parameter.Value)
      .catch((error: unknown) => {
        // Read it again next time, rather than keep the failure.
        key = undefined;
        throw error;
      });
    return key;
  };
}
