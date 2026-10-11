// Loads one answer from the page's API, with the session token, and parses
// it with the schema both sides share. When a load fails, the page keeps
// what it has, says it is not connected, and tries again a few seconds
// later, only while the page is visible (polling.md).
import { useEffect, useState } from "react";
import type { z } from "zod";
import { useAuth } from "./auth";

const retryMs = 5000;

export interface Answer<T> {
  data: T | undefined;
  // When the data arrived, so ages are counted from one moment.
  receivedAt: number;
  failed: boolean;
}

export function useAnswer<T>(path: string, schema: z.ZodType<T>): Answer<T> {
  const { getToken } = useAuth();
  const [answer, setAnswer] = useState<Answer<T>>({
    data: undefined,
    receivedAt: 0,
    failed: false,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    const tryAgain = () => {
      if (document.visibilityState === "visible") {
        setAttempt((count) => count + 1);
      } else {
        document.addEventListener("visibilitychange", tryAgain, {
          once: true,
          signal: controller.signal,
        });
      }
    };
    const load = async () => {
      const token = await getToken();
      const response = await fetch(path, {
        headers: { authorization: `Bearer ${token ?? ""}` },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`The API answered ${String(response.status)}.`);
      }
      return schema.parse(await response.json());
    };
    load().then(
      (data) => {
        setAnswer({ data, receivedAt: Date.now(), failed: false });
      },
      () => {
        if (controller.signal.aborted) return;
        setAnswer((previous) => ({ ...previous, failed: true }));
        timer = window.setTimeout(tryAgain, retryMs);
      },
    );
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [path, schema, getToken, attempt]);

  return answer;
}
