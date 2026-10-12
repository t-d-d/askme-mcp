// Runs the sort jobs the service queued, through the sort function's
// handler, as Lambda's trigger would (ADR 9).
import { handler as sorter } from "../service/src/sorter";
import { fakes } from "./fakes";

// Delivers the jobs queued so far, then lets go of any whose sort failed,
// so none comes round again in a later test. Gives how many runs it made.
export async function runSorts(): Promise<number> {
  const runs = await fakes.queue.deliver((event) =>
    sorter(event, { awsRequestId: "sort-1" }),
  );
  fakes.queue.purge();
  return runs;
}
