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
// daily cap on model calls resets, with that clock.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  pagePaths,
  pollAnswer,
  sinceParam,
  type AsksAnswer,
} from "../../shared/page-api";
import { useAuth } from "./auth";
import { loadDated } from "./load";
import { pollMs } from "./poll";
import type { Answer } from "./useAnswer";

const pollPath = (since: number | undefined) =>
  since === undefined
    ? pagePaths.asks
    : `${pagePaths.asks}?${sinceParam}=${String(since)}`;

const queryKey = [pagePaths.asks];

// The list as the cache holds it, with how far the service's clock was
// ahead of this browser's at the last poll that reached askme (load.ts).
interface Polled {
  list: AsksAnswer;
  serviceAhead: number;
}

// The list, and when the page last polled for it, whether or not the poll
// reached askme. Which asks are held is counted from then, so a held ask
// is let go at its hours even while the page is not connected. With it, how
// far the service's clock was ahead of this browser's at the last poll that
// reached askme, or 0 before one has.
export interface PolledAnswer extends Answer<AsksAnswer> {
  polledAt: number;
  serviceAhead: number;
}

export function useAsks(): PolledAnswer {
  const { getToken } = useAuth();
  const queries = useQueryClient();
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      // The list the page has, kept in the cache across screens. An answer
      // that nothing changed keeps it.
      const held = queries.getQueryData<Polled>(queryKey)?.list;
      const { answer, serviceAhead } = await loadDated(
        pollPath(held?.version),
        pollAnswer,
        getToken,
        signal,
      );
      if ("unchanged" in answer) {
        if (held === undefined) {
          throw new Error("The API said nothing changed, with no list held.");
        }
        return { list: held, serviceAhead };
      }
      return { list: answer, serviceAhead };
    },
    refetchInterval: pollMs,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  return {
    data: query.data?.list,
    receivedAt: query.dataUpdatedAt,
    polledAt: Math.max(query.dataUpdatedAt, query.errorUpdatedAt),
    serviceAhead: query.data?.serviceAhead ?? 0,
    failed: query.isError,
  };
}
