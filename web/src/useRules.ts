// The account's rules: loaded once, and saved with a call that waits while
// askme reads the hashtags and their hours from them. A saved answer
// replaces the loaded one, so the hashtags shown change only when a save
// finishes. A save sends this browser's time zone, which the hours use
// (PRD, "Rules").
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  pagePaths,
  rulesAnswer,
  type RulesAnswer,
} from "../../shared/page-api";
import { useAuth } from "./auth";
import { send } from "./load";
import { useAnswer } from "./useAnswer";

// The time zone this browser is in, such as Europe/London.
export const browserTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

export function useRules() {
  const { getToken } = useAuth();
  const queries = useQueryClient();
  const loaded = useAnswer(pagePaths.rules, rulesAnswer);
  const save = useMutation({
    mutationFn: (text: string) =>
      send(
        pagePaths.rules,
        { text, timeZone: browserTimeZone() },
        rulesAnswer,
        getToken,
      ),
    onSuccess: (answer: RulesAnswer) => {
      queries.setQueryData([pagePaths.rules], answer);
    },
  });
  return { loaded, save };
}
