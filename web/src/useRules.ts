import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  pagePaths,
  rulesAnswer,
  rulesInput,
  type RulesAnswer,
  type RulesInput,
} from "../../shared/page-api";
import { useAuth } from "./auth";
import { send } from "./load";
import { useAnswer } from "./useAnswer";

export const browserTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

// A time zone askme would refuse is left out, so the save still goes and
// the time zone saved before stays.
export function rulesToSave(
  text: string,
  timeZone: string | undefined,
): RulesInput {
  const fits = rulesInput.shape.timeZone.safeParse(timeZone);
  return fits.success && fits.data !== undefined
    ? { text, timeZone: fits.data }
    : { text };
}

export function useRules() {
  const { getToken } = useAuth();
  const queries = useQueryClient();
  const loaded = useAnswer(pagePaths.rules, rulesAnswer);
  const save = useMutation({
    mutationFn: (text: string) =>
      send(
        pagePaths.rules,
        rulesToSave(text, browserTimeZone()),
        rulesAnswer,
        getToken,
      ),
    onSuccess: (answer: RulesAnswer) => {
      queries.setQueryData([pagePaths.rules], answer);
      // A save queues sorts, so the list is polled now to show them.
      void queries.invalidateQueries({ queryKey: [pagePaths.asks] });
    },
  });
  return { loaded, save };
}
