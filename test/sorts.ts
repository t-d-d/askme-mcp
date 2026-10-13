import { handler as sorter } from "../service/src/sorter";
import { fakes } from "./fakes";

export async function runSorts(): Promise<number> {
  const runs = await fakes.queue.deliver((event) =>
    sorter(event, { awsRequestId: "sort-1" }),
  );
  // So a failed job does not come round again in a later run.
  fakes.queue.purge();
  return runs;
}
