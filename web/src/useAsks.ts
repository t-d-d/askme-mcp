// The person's open asks, polled every few seconds while the page is
// visible, and once more whenever it becomes visible again. A hidden page
// sends nothing (polling.md).
//
// Each poll carries the version of the list the page has, so a poll with
// nothing new is answered with the version alone and costs the service one
// read. When a poll fails, the page keeps the list it has and says it is not
// connected, and the next poll tries again.
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import {
  pagePaths,
  pollAnswer,
  sinceParam,
  type AsksAnswer,
} from "../../shared/page-api";
import { useAuth } from "./auth";
import { load } from "./load";
import { pollMs } from "./poll";
import type { Answer } from "./useAnswer";

const pollPath = (since: number | undefined) =>
  since === undefined
    ? pagePaths.asks
    : `${pagePaths.asks}?${sinceParam}=${String(since)}`;

export function useAsks(): Answer<AsksAnswer> {
  const { getToken } = useAuth();
  // The list the page has. An answer that nothing changed keeps it.
  const held = useRef<AsksAnswer>(undefined);
  const query = useQuery({
    queryKey: [pagePaths.asks],
    queryFn: async ({ signal }) => {
      const answer = await load(
        pollPath(held.current?.version),
        pollAnswer,
        getToken,
        signal,
      );
      if ("unchanged" in answer) {
        if (held.current === undefined) {
          throw new Error("The API said nothing changed, with no list held.");
        }
        return held.current;
      }
      held.current = answer;
      return answer;
    },
    refetchInterval: pollMs,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  return {
    data: query.data,
    receivedAt: query.dataUpdatedAt,
    failed: query.isError,
  };
}
