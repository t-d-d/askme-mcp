import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Asks } from "./Asks";
import { Connect } from "./Connect";
import { Rules } from "./Rules";

type Screen = "asks" | "connect" | "rules";

// A screen with unsaved work gives the question to ask before it is left,
// and null once it can be left without asking.
export type AskFirst = (question: string | null) => void;

// Where this page's entry sits in the history, where the browser can say.
const historyIndex = (): number | null =>
  "navigation" in window
    ? (window.navigation.currentEntry?.index ?? null)
    : null;

// The page is static files with no router (ADR 5), so its screens are
// named in the address's fragment: #connect, #rules, and anything else for
// the list. Links between them are real links, and Back works.
function useScreen(): { screen: Screen; askFirst: AskFirst } {
  const [hash, setHash] = useState(() => window.location.hash);
  const question = useRef<string | null>(null);
  useEffect(() => {
    let at = historyIndex();
    let returning = false;
    // A link, Back or a typed address has changed the fragment before the
    // page hears of it. If the person stays, the page goes back to the
    // entry they were on, so the history is left as it was. A browser that
    // cannot say where that entry is gets the old address as a new entry.
    const follow = (event: HashChangeEvent) => {
      if (returning) {
        returning = false;
        return;
      }
      const here = historyIndex();
      if (question.current !== null && !window.confirm(question.current)) {
        if (at !== null && here !== null && at !== here) {
          returning = true;
          window.history.go(at - here);
        } else {
          window.history.pushState(null, "", event.oldURL);
          at = historyIndex();
        }
        return;
      }
      at = here;
      setHash(window.location.hash);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", follow);
    return () => {
      window.removeEventListener("hashchange", follow);
    };
  }, []);
  const askFirst = useCallback<AskFirst>((asked) => {
    question.current = asked;
  }, []);
  const screen =
    hash === "#connect" ? "connect" : hash === "#rules" ? "rules" : "asks";
  return { screen, askFirst };
}

// A failed load shows at once, and the page's own timers try again, so
// nothing is retried behind its back.
const newQueries = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

// Each time someone signs in, the page loads into a cache of its own, which
// goes when they sign out. Nothing one account loaded can show to the next,
// and the next one's first poll carries no version.
export function SignedIn() {
  const [queries] = useState(newQueries);
  const { screen, askFirst } = useScreen();
  return (
    <QueryClientProvider client={queries}>
      <Shown screen={screen} askFirst={askFirst} />
    </QueryClientProvider>
  );
}

function Shown({ screen, askFirst }: { screen: Screen; askFirst: AskFirst }) {
  switch (screen) {
    case "asks":
      return <Asks />;
    case "connect":
      return <Connect />;
    case "rules":
      return <Rules askFirst={askFirst} />;
  }
}
