// Loads one answer from the page's API once. When the load fails, the page
// keeps what it has, says it is not connected, and tries again a few seconds
// later, only while the page is visible (polling.md).
import { useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import { useAuth } from "./auth";
import { load } from "./load";
import { retryMs } from "./poll";

export interface Answer<T> {
  data: T | undefined;
  // When the data last arrived, so ages are counted from one moment.
  receivedAt: number;
  failed: boolean;
}

export function useAnswer<T>(path: string, schema: z.ZodType<T>): Answer<T> {
  const { getToken } = useAuth();
  const query = useQuery({
    queryKey: [path],
    queryFn: ({ signal }) => load(path, schema, getToken, signal),
    // Loaded once. Only a failed load is tried again.
    staleTime: Infinity,
    refetchInterval: ({ state }) =>
      state.status === "error" ? retryMs : false,
  });
  return {
    data: query.data,
    receivedAt: query.dataUpdatedAt,
    failed: query.isError,
  };
}
