// The account's rules: loaded once, and saved with a call that waits while
// askme reads the hashtags and their hours from them. A saved answer
// replaces the loaded one, so the hashtags shown change only when a save
// finishes. A save sends this browser's time zone, which the hours use
// (PRD, "Rules"), when it is a name askme takes.
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

// The time zone this browser is in, such as Europe/London.
export const browserTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

// The rules as a save sends them: the text, and this browser's time zone
// when it is a name askme takes. A name it would refuse is left out, so
// the save still goes, and the time zone saved before stays.
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
      // A save queues sorts, so the list is polled again at once, and shows
      // the asks being sorted. The save does not wait for it.
      void queries.invalidateQueries({ queryKey: [pagePaths.asks] });
    },
  });
  return { loaded, save };
}
