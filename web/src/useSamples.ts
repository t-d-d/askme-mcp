import { useMutation, useQueryClient } from "@tanstack/react-query";
import { pagePaths } from "../../shared/page-api";
import { useAuth } from "./auth";
import { sendSamples } from "./load";

export function useSamples(onSent?: () => void) {
  const { getToken } = useAuth();
  const queries = useQueryClient();
  return useMutation({
    mutationFn: () => sendSamples(getToken),
    onSuccess: () => {
      onSent?.();
    },
    // On a refusal too: a limit reached part way keeps the asks posted
    // before it.
    onSettled: async () => {
      await queries.invalidateQueries({ queryKey: [pagePaths.asks] });
    },
  });
}
