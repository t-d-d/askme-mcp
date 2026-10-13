import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  pagePaths,
  pollAnswer,
  sinceParam,
  type AsksAnswer,
} from "../../shared/page-api";
import { useAuth } from "./auth";
import { countOn, loadDated, momentNow, type Counted } from "./load";
import { pollMs } from "./poll";
import { answerRead, reloadOnce, sessionMarks } from "./reload";
import type { Answer } from "./useAnswer";

const pollPath = (since: number | undefined) =>
  since === undefined
    ? pagePaths.asks
    : `${pagePaths.asks}?${sinceParam}=${String(since)}`;

const queryKey = [pagePaths.asks];

interface Polled extends Counted {
  list: AsksAnswer;
}

class PollFailed extends Error {
  readonly counted: Counted | undefined;
  constructor(counted: Counted | undefined, cause: unknown) {
    super("A poll for the list failed.", { cause });
    this.name = "PollFailed";
    this.counted = counted;
  }
}

// At module level, so it counts whichever screen is showing.
let visibilityChanges = 0;
document.addEventListener("visibilitychange", () => {
  visibilityChanges += 1;
});

// polledAt counts failed polls too, so a held ask is let go at its hours
// while the page is not connected. serviceAhead goes with polledAt, and
// receivedAhead with receivedAt.
export interface PolledAnswer extends Answer<AsksAnswer> {
  polledAt: number;
  serviceAhead: number;
  receivedAhead: number;
}

export function useAsks(): PolledAnswer {
  const { getToken } = useAuth();
  const queries = useQueryClient();
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }): Promise<Polled> => {
      const held = queries.getQueryData<Polled>(queryKey);
      const changesWhenSent = visibilityChanges;
      try {
        const { answer, serviceAhead } = await loadDated(
          pollPath(held?.list.version),
          pollAnswer,
          getToken,
          signal,
        );
        answerRead(sessionMarks);
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
        // An answer in a shape the page does not know means a deploy has
        // changed it, and a newer page can read it.
        if (error instanceof z.ZodError) {
          reloadOnce(sessionMarks, () => {
            window.location.reload();
          });
        }
        // React Query keeps a failure until a poll succeeds, so count on
        // from the last failure if there is one.
        const before = queries.getQueryState(queryKey)?.error;
        const from = before instanceof PollFailed ? before.counted : held;
        throw new PollFailed(
          from === undefined
            ? undefined
            : countOn(from, momentNow(), visibilityChanges),
          error,
        );
      }
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
    serviceAhead:
      query.error instanceof PollFailed
        ? (query.error.counted?.serviceAhead ?? 0)
        : (query.data?.serviceAhead ?? 0),
    receivedAhead: query.data?.serviceAhead ?? 0,
    failed: query.isError,
  };
}
