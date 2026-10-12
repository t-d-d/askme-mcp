// "Send sample asks" (PRD, "Web page"): askme posts one sample ask from each
// of three areas, as an agent would, so the person can watch their rules
// sort them with no agent connected. Once they are posted, the list is
// asked for at once, not at the next poll.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { pagePaths } from "../../shared/page-api";
import { useAuth } from "./auth";
import { sendSamples } from "./load";

export function useSamples(onSent?: () => void) {
  const { getToken } = useAuth();
  const queries = useQueryClient();
  return useMutation({
    mutationFn: () => sendSamples(getToken),
    onSuccess: async () => {
      onSent?.();
      await queries.invalidateQueries({ queryKey: [pagePaths.asks] });
    },
  });
}
