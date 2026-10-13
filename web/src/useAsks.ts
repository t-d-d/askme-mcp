// The person's open asks, polled every few seconds while the page is
// visible, and once more whenever it becomes visible again. A hidden page
// sends nothing (polling.md).
//
// Each poll carries the version of the list the page has, so a poll with
// nothing new is answered with the version alone and costs the service one
// read. When a poll fails, the page keeps the list it has and says it is not
// connected, and the next poll tries again.
//
// Each answer's Date header also gives the service's time. The page
// compares a time the list gives by the service's clock, such as when the
// daily cap on model calls resets, with that clock. While polls fail, the
// page counts the service's clock on from the last poll that reached askme
// (aheadSince in load.ts), so the device putting its own clock right in the
// meantime moves none of those times.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  pagePaths,
  pollAnswer,
  sinceParam,
  type AsksAnswer,
} from "../../shared/page-api";
import { useAuth } from "./auth";
import { aheadSince, loadDated, momentNow, type Moment } from "./load";
import { pollMs } from "./poll";
import type { Answer } from "./useAnswer";

const pollPath = (since: number | undefined) =>
  since === undefined
    ? pagePaths.asks
    : `${pagePaths.asks}?${sinceParam}=${String(since)}`;

const queryKey = [pagePaths.asks];

// The list as the cache holds it, with how far the service's clock was
// ahead of this browser's at the last poll that reached askme (load.ts),
// the moment its answer came, and visibilityChanges as it was sent.
interface Polled {
  list: AsksAnswer;
  serviceAhead: number;
  at: Moment;
  visibilityChanges: number;
}

// A poll that failed, with how far the service's clock was ahead of this
// browser's as it failed, counted on from the last poll that reached askme,
// or 0 before one has.
class PollFailed extends Error {
  readonly serviceAhead: number;
  constructor(serviceAhead: number, cause: unknown) {
    super("A poll for the list failed.", { cause });
    this.name = "PollFailed";
    this.serviceAhead = serviceAhead;
  }
}

// Counts each time the page is hidden or shown, from when the page loads,
// whichever screen is showing. It stands still only while the page has been
// visible throughout.
let visibilityChanges = 0;
document.addEventListener("visibilitychange", () => {
  visibilityChanges += 1;
});

// The list, and when the page last polled for it, whether or not the poll
// reached askme. Which asks are held is counted from then, so a held ask
// is let go at its hours even while the page is not connected. With it, how
// far the service's clock is ahead of this browser's as of that poll: as the
// last poll that reached askme found it, counted on since then while polls
// fail, or 0 before a poll has reached askme.
export interface PolledAnswer extends Answer<AsksAnswer> {
  polledAt: number;
  serviceAhead: number;
}

export function useAsks(): PolledAnswer {
  const { getToken } = useAuth();
  const queries = useQueryClient();
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }): Promise<Polled> => {
      // The list the page has, kept in the cache across screens. An answer
      // that nothing changed keeps it.
      const held = queries.getQueryData<Polled>(queryKey);
      const changesWhenSent = visibilityChanges;
      try {
        const { answer, serviceAhead } = await loadDated(
          pollPath(held?.list.version),
          pollAnswer,
          getToken,
          signal,
        );
        const polled = {
          serviceAhead,
          at: momentNow(),
          visibilityChanges: changesWhenSent,
        };
        if ("unchanged" in answer) {
          if (held === undefined) {
            throw new Error("The API said nothing changed, with no list held.");
          }
          return { list: held.list, ...polled };
        }
        return { list: answer, ...polled };
      } catch (error) {
        throw new PollFailed(
          held === undefined
            ? 0
            : aheadSince(
                held.serviceAhead,
                held.at,
                momentNow(),
                held.visibilityChanges === visibilityChanges,
              ),
          error,
        );
      }
    },
    refetchInterval: pollMs,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  return {
    data: query.data?.list,
    receivedAt: query.dataUpdatedAt,
    // The time of the poll that came last, which is the failure's while polls
    // fail. The later of the two times would be the older poll's once the
    // device puts its clock back.
    polledAt: query.isError ? query.errorUpdatedAt : query.dataUpdatedAt,
    serviceAhead:
      query.error instanceof PollFailed
        ? query.error.serviceAhead
        : (query.data?.serviceAhead ?? 0),
    failed: query.isError,
  };
}
