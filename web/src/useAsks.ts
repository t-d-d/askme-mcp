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

interface Polled {
  list: AsksAnswer;
  serviceAhead: number;
}

// polledAt counts failed polls too, so a held ask is let go at its hours
// while the page is not connected.
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
      const held = queries.getQueryData<Polled>(queryKey);
      const { answer, serviceAhead } = await loadDated(
        pollPath(held?.list.version),
        pollAnswer,
        getToken,
        signal,
      );
      if ("unchanged" in answer) {
        if (held === undefined) {
          throw new Error("The API said nothing changed, with no list held.");
        }
        return { list: held.list, serviceAhead };
      }
      return { list: answer, serviceAhead };
    },
    // Only while visible, and once on becoming visible (polling.md).
    refetchInterval: pollMs,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  return {
    data: query.data?.list,
    receivedAt: query.dataUpdatedAt,
    // Not the later of the two: once the device sets its clock back, that
    // would be the older poll's.
    polledAt: query.isError ? query.errorUpdatedAt : query.dataUpdatedAt,
    // The last poll that reached askme sets the offset, and failed polls
    // keep it. So if the device's clock is set while polls fail, the page's
    // times move by that much until a poll gets through. This is a chosen
    // trade-off. The page once corrected for it, with performance.now() and
    // a guess at when the device slept, and that code cost more than so rare
    // a case is worth. Do not bring the correction back without the owner's
    // decision.
    serviceAhead: query.data?.serviceAhead ?? 0,
    failed: query.isError,
  };
}
